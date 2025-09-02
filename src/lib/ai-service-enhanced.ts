import { prisma } from "@/lib/prisma";
import {
	getGeminiClient,
	recordKeyUsage,
	getActiveModelNames,
} from "@/lib/ai-key-store";
import { HybridSearchService } from "./hybrid-search";
import { getSettingInt } from "@/lib/app-settings";

// Developer logging toggle - set to true to see query logs in console
const DEV_LOGGING = true;

// Configuration for relevance extraction
// This feature extracts only relevant information from records to reduce token usage
// while maintaining answer quality. It's particularly useful for large datasets.
const RELEVANCE_EXTRACTION_CONFIG = {
	enabled: false, // Set to false to disable relevance extraction completely
	threshold: 50, // Enable for queries with more than this many records
	debug: true, // Set to true to see detailed extraction logs
};

/**
 * RELEVANCE EXTRACTION FEATURE
 *
 * This feature intelligently extracts only relevant information from database records
 * to reduce token usage while maintaining answer quality. It works by:
 *
 * 1. Analyzing the user's query for keywords
 * 2. Scoring each record's relevance based on query matches
 * 3. For highly relevant records: keeping full content
 * 4. For less relevant records: extracting only key sentences
 *
 * Configuration:
 * - enabled: Set to false to disable completely
 * - threshold: Number of records above which extraction is enabled
 * - debug: Set to true for detailed logging
 *
 * To disable: Set RELEVANCE_EXTRACTION_CONFIG.enabled = false
 * To adjust threshold: Change RELEVANCE_EXTRACTION_CONFIG.threshold
 */

// Performance timing helper function
function timeStart(label: string) {
	const uniqueLabel = `${label}_${Date.now()}_${Math.random()
		.toString(36)
		.substr(2, 9)}`;
	console.time(`[TIMING] ${uniqueLabel}`);
	console.log(`[TIMING-START] ${label}`);
	return { startTime: Date.now(), uniqueLabel };
}

function timeEnd(
	label: string,
	timingData: { startTime: number; uniqueLabel: string }
) {
	const elapsed = Date.now() - timingData.startTime;
	console.timeEnd(`[TIMING] ${timingData.uniqueLabel}`);
	console.log(`[TIMING-END] ${label} took ${elapsed}ms`);
	return elapsed;
}

/**
 * Developer logging helper function
 */
function devLog(message: string, data?: any) {
	if (DEV_LOGGING) {
		console.log(`[AI-SERVICE-DEV] ${message}`);
		if (data !== undefined) {
			console.log(data);
		}
		console.log("---");
	}
}

// Gemini client is now constructed per-call via getGeminiClient() to support
// admin-managed key rotation and dynamic provider/model selection.

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: Date;
	sources?: Array<{
		id: number;
		file_no: string;
		title: string;
	}>;
	tokenCount?: {
		input: number;
		output: number;
	};
}

export interface SearchResult {
	id: number;
	file_no: string;
	category: string;
	title: string;
	note: string | null;
	entry_date_real: Date | null;
	rank?: number; // For relevance ranking
	ts_rank?: number;
	semantic_similarity?: number;
	combined_score?: number;
}

/**
 * Analyze user query and extract search keywords using AI
 */
export async function analyzeQueryForSearch(
	currentQuery: string,
	conversationHistory: ChatMessage[] = [],
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {}
): Promise<{
	coreSearchTerms: string;
	instructionalTerms: string;
	queryType:
		| "specific_search"
		| "follow_up"
		| "elaboration"
		| "general"
		| "recent_files"
		| "analytical_query";
	contextNeeded: boolean;
	inputTokens: number;
	outputTokens: number;
}> {
	try {
		// First check if this is a recent/latest files query
		const recentFilesPattern =
			/\b(recent|latest|newest|last|most recent)\s+(files?|records?|cases?|entries?)\b/i;
		const numberPattern =
			/\b(\d+)\s+(recent|latest|newest|last|most recent)\s+(files?|records?|cases?|entries?)\b/i;

		if (
			recentFilesPattern.test(currentQuery) ||
			numberPattern.test(currentQuery)
		) {
			console.log("[QUERY ANALYSIS] Detected recent files query");
			return {
				coreSearchTerms: currentQuery, // Keep original for context
				instructionalTerms: "",
				queryType: "recent_files",
				contextNeeded: false,
				inputTokens: 0,
				outputTokens: 0,
			};
		}

		const { client, keyId } = await getGeminiClient({
			provider: "gemini",
			keyId: opts.keyId,
		});
		const dbModels = await getActiveModelNames("gemini");
		const attemptModels = Array.from(
			new Set([opts.model, ...dbModels].filter(Boolean))
		);

		// Build conversation context
		const recentHistory = conversationHistory.slice(-6); // Last 3 exchanges
		const historyContext =
			recentHistory.length > 0
				? `\nRECENT CONVERSATION:\n${recentHistory
						.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
						.join("\n")}\n`
				: "";

		const prompt = `You are an AI assistant analyzing queries for a database search system.

${historyContext}

CURRENT USER QUERY: "${currentQuery}"

Your task is to:
1. Determine the query type
2. Extract the core search terms for database search
3. Extract the instructional terms for database search
4. Decide if conversation context is needed

Query Types:
- specific_search: Direct questions about cases, people, dates, etc. ("Details of case 123", "Who is John Doe?").
- analytical_query: Questions that require analysis, summarization, or finding patterns across multiple records (e.g., 'most common', 'how many', 'what is the trend', 'summarize').
- follow_up: Questions referring to previous results ("Who caught her?", "What happened next?").
- elaboration: Requests for more details ("Elaborate", "Tell me more", "Explain further").
- general: General questions or greetings.
- recent_files: Queries asking for recent/latest/newest files (handled separately).

IMPORTANT:
- If the query asks for "recent", "latest", "newest", or "most recent" files/records/cases, classify it as "recent_files".
- "coreSearchTerms" should be specific entities, names, IDs, or unique identifiers that directly map to data in the database. Do NOT include words that describe the type of query or action to be performed (e.g., 'summarize', 'analyze', 'case' when it's part of 'the case on X').
- "instructionalTerms" are words that describe the action (e.g., 'summarize', 'analyze') or the general type of record (e.g., 'case', 'incident') when they are not specific entities.

For follow_up and elaboration queries, you MUST extract keywords from the conversation history.

Respond in this exact JSON format:
{
  "coreSearchTerms": "extracted core search terms for database search",
  "instructionalTerms": "extracted instructional terms for database search",
  "queryType": "one of the five types above",
  "contextNeeded": true/false
}

Examples:
- "Cases from 2007?" → {"coreSearchTerms": "cases 2007", "instructionalTerms": "", "queryType": "specific_search", "contextNeeded": false}
- "Who caught her?" → {"coreSearchTerms": "caught arrest suspect", "instructionalTerms": "", "queryType": "follow_up", "contextNeeded": true}
- "Show me the most recent 3 files" → {"coreSearchTerms": "recent files", "instructionalTerms": "3", "queryType": "recent_files", "contextNeeded": false}
- "Latest cases" → {"coreSearchTerms": "latest cases", "instructionalTerms": "", "queryType": "recent_files", "contextNeeded": false}
- "Summarize the case on Zothansangi" → {"coreSearchTerms": "Zothansangi", "instructionalTerms": "summarize case", "queryType": "analytical_query", "contextNeeded": false}

`;

		let text: string = "";
		let analysisInputTokens = 0;
		let analysisOutputTokens = 0;
		let lastError: any = null;
		for (const modelName of attemptModels) {
			try {
				const model = client.getGenerativeModel({ model: modelName as string });
				console.log(
					`[AI] provider=gemini model=${modelName} keyId=${
						keyId ?? "env-fallback"
					}`
				);
				// Count input tokens using provider-native method
				try {
					const countRes: any = await model.countTokens({
						contents: [
							{
								role: "user",
								parts: [{ text: prompt }],
							},
						],
					});
					analysisInputTokens = (countRes?.totalTokens ??
						countRes?.totalTokenCount ??
						0) as number;
				} catch (e) {
					analysisInputTokens = estimateTokenCount(prompt);
					console.warn(
						"[QUERY ANALYSIS] countTokens failed; using heuristic",
						e
					);
				}
				const result = await model.generateContent(prompt);
				const response = await result.response;
				text = response.text().trim();
				// Capture output tokens from usage metadata if available
				const usage: any = (response as any)?.usageMetadata;
				analysisOutputTokens = (usage?.candidatesTokenCount ??
					usage?.totalTokenCount ??
					estimateTokenCount(text)) as number;
				if (keyId) await recordKeyUsage(keyId, true);
				lastError = null;
				break;
			} catch (e) {
				lastError = e;
				if (keyId) await recordKeyUsage(keyId, false);
				console.warn(`[AI] model attempt failed: ${modelName}`, e);
				continue;
			}
		}
		if (lastError) throw lastError;

		console.log("[QUERY ANALYSIS] Raw AI response:", text);

		// Extract JSON from response
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.error("[QUERY ANALYSIS] No JSON found in response:", text);
			throw new Error("Invalid response format from AI");
		}

		let analysis;
		try {
			analysis = JSON.parse(jsonMatch[0]);
			console.log("[QUERY ANALYSIS] Parsed analysis:", analysis);
		} catch (parseError) {
			console.error("[QUERY ANALYSIS] JSON parse error:", parseError);
			console.error("[QUERY ANALYSIS] JSON string:", jsonMatch[0]);
			throw new Error("Invalid JSON format from AI");
		}

		// Validate response
		if (!analysis.coreSearchTerms || !analysis.queryType) {
			console.error("[QUERY ANALYSIS] Incomplete analysis:", analysis);
			throw new Error("Incomplete analysis from AI");
		}

		return {
			coreSearchTerms: analysis.coreSearchTerms,
			instructionalTerms: analysis.instructionalTerms || "",
			queryType: analysis.queryType,
			contextNeeded: analysis.contextNeeded || false,
			inputTokens: analysisInputTokens,
			outputTokens: analysisOutputTokens,
		};
	} catch (error) {
		console.error("Query analysis error:", error);

		// Fallback to simple keyword extraction
		const fallbackKeywords = currentQuery
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(" ")
			.filter((word) => word.length > 2)
			.join(" ");

		return {
			coreSearchTerms: fallbackKeywords || currentQuery,
			instructionalTerms: "",
			queryType: "specific_search",
			contextNeeded: false,
			inputTokens: 0,
			outputTokens: 0,
		};
	}
}

/**
 * Get recent files sorted by date
 */
export async function getRecentFiles(
	limit: number = 10
): Promise<SearchResult[]> {
	try {
		console.log(`[RECENT FILES] Fetching ${limit} most recent files`);

		const records = await prisma.fileList.findMany({
			select: {
				id: true,
				file_no: true,
				category: true,
				title: true,
				note: true,
				entry_date_real: true,
			},
			where: {
				entry_date_real: {
					not: null,
				},
			},
			orderBy: {
				entry_date_real: "desc",
			},
			take: limit,
		});

		console.log(`[RECENT FILES] Found ${records.length} recent files`);

		return records.map((record) => ({
			...record,
			rank: 1.0, // All recent files have equal relevance
		}));
	} catch (error) {
		console.error("Recent files query error:", error);
		throw new Error("Failed to fetch recent files");
	}
}

/**
 * Extract only relevant information from records to reduce token usage
 */
export function extractRelevantInformation(
	records: SearchResult[],
	query: string
): SearchResult[] {
	if (!RELEVANCE_EXTRACTION_CONFIG.enabled) {
		return records; // Return original records if feature is disabled
	}

	console.log(
		`[RELEVANCE-EXTRACTION] Extracting relevant information from ${records.length} records`
	);

	// Convert query to lowercase for matching
	const queryLower = query.toLowerCase();
	const queryWords = queryLower.split(/\s+/).filter((word) => word.length > 2);

	// Use semantic search scores to determine relevance
	return records.map((record) => {
		const originalNote = record.note || "";
		const title = record.title || "";
		const category = record.category || "";

		// Calculate relevance score based on semantic search results
		const relevanceScore = calculateRelevanceScore(record, queryWords, query);

		// Determine relevance level based on score
		const relevanceLevel = determineRelevanceLevel(relevanceScore, record);

		// Apply appropriate extraction based on relevance level
		switch (relevanceLevel) {
			case "high":
				// Keep full content for highly relevant records
				return record;
			case "medium":
				// Extract key information for medium relevance
				const extractedNote = extractKeyInformation(
					originalNote,
					queryWords,
					query
				);
				return {
					...record,
					note: extractedNote,
					_processed: true,
				};
			case "low":
			default:
				// Extract minimal information for low relevance
				const minimalNote = extractMinimalInformation(
					originalNote,
					queryWords,
					query
				);
				return {
					...record,
					note: minimalNote,
					_processed: true,
				};
		}
	});
}

/**
 * Calculate relevance score based on semantic search results and query analysis
 */
function calculateRelevanceScore(
	record: SearchResult,
	queryWords: string[],
	query: string
): number {
	let score = 0;

	// Use semantic similarity score if available
	if (record.semantic_similarity !== undefined) {
		score += record.semantic_similarity * 10; // Scale semantic similarity
	}

	// Use combined score if available
	if (record.combined_score !== undefined) {
		score += record.combined_score * 5; // Scale combined score
	}

	// Use rank if available (lower rank = higher relevance)
	if (record.rank !== undefined) {
		score += (100 - record.rank) / 10; // Convert rank to score
	}

	// Query word matches in title and content
	const titleLower = record.title.toLowerCase();
	const noteLower = (record.note || "").toLowerCase();
	const categoryLower = (record.category || "").toLowerCase();

	queryWords.forEach((word) => {
		// Title matches get higher weight
		if (titleLower.includes(word)) {
			score += 5;
		}
		// Content matches
		if (noteLower.includes(word)) {
			score += 3;
		}
		// Category matches
		if (categoryLower.includes(word)) {
			score += 2;
		}
	});

	// Analyze query type and adjust scoring
	const queryType = analyzeQueryType(query);
	score = adjustScoreForQueryType(score, queryType, record);

	return score;
}

/**
 * Analyze the type of query to determine what information is most relevant
 */
function analyzeQueryType(query: string): string {
	const queryLower = query.toLowerCase();

	// Check for specific query patterns
	if (queryLower.includes("victim") && queryLower.includes("suspect")) {
		// Check if age is also mentioned
		if (
			queryLower.includes("age") ||
			queryLower.includes("old") ||
			queryLower.includes("years")
		) {
			return "victim_suspect_with_age";
		}
		return "victim_suspect";
	}
	if (
		queryLower.includes("location") ||
		queryLower.includes("place") ||
		queryLower.includes("where")
	) {
		return "location";
	}
	if (
		queryLower.includes("date") ||
		queryLower.includes("when") ||
		queryLower.includes("time")
	) {
		return "temporal";
	}
	if (queryLower.includes("age") || queryLower.includes("old")) {
		return "demographic";
	}
	if (
		queryLower.includes("list") ||
		queryLower.includes("all") ||
		queryLower.includes("every")
	) {
		return "comprehensive";
	}
	if (
		queryLower.includes("count") ||
		queryLower.includes("number") ||
		queryLower.includes("total")
	) {
		return "statistical";
	}

	return "general";
}

/**
 * Adjust relevance score based on query type
 */
function adjustScoreForQueryType(
	score: number,
	queryType: string,
	record: SearchResult
): number {
	const noteLower = (record.note || "").toLowerCase();

	switch (queryType) {
		case "victim_suspect":
			// Boost score for records containing victim/suspect information
			if (
				noteLower.includes("victim") ||
				noteLower.includes("suspect") ||
				noteLower.includes("accused") ||
				noteLower.includes("complainant")
			) {
				score += 10;
			}
			break;
		case "victim_suspect_with_age":
			// Boost score for records containing victim/suspect information AND age
			if (
				noteLower.includes("victim") ||
				noteLower.includes("suspect") ||
				noteLower.includes("accused") ||
				noteLower.includes("complainant") ||
				noteLower.includes("age") ||
				noteLower.includes("old") ||
				noteLower.includes("years")
			) {
				score += 10;
			}
			break;
		case "location":
			// Boost score for records containing location information
			if (
				noteLower.includes("location") ||
				noteLower.includes("place") ||
				noteLower.includes("address") ||
				noteLower.includes("where")
			) {
				score += 8;
			}
			break;
		case "temporal":
			// Boost score for records containing date/time information
			if (
				noteLower.includes("date") ||
				noteLower.includes("time") ||
				/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(noteLower)
			) {
				score += 6;
			}
			break;
		case "demographic":
			// Boost score for records containing age information
			if (noteLower.includes("age") || /\d+\s*years?\s*old/.test(noteLower)) {
				score += 7;
			}
			break;
		case "comprehensive":
			// For comprehensive queries, keep more records relevant
			score += 3;
			break;
		case "statistical":
			// For statistical queries, focus on records with numbers
			if (/\d+/.test(noteLower)) {
				score += 4;
			}
			break;
	}

	return score;
}

/**
 * Determine relevance level based on calculated score
 */
function determineRelevanceLevel(
	score: number,
	record: SearchResult
): "high" | "medium" | "low" {
	// Use semantic similarity as primary indicator if available
	if (record.semantic_similarity !== undefined) {
		if (record.semantic_similarity > 0.7) return "high";
		if (record.semantic_similarity > 0.4) return "medium";
		return "low";
	}

	// Use combined score if available
	if (record.combined_score !== undefined) {
		if (record.combined_score > 0.6) return "high";
		if (record.combined_score > 0.3) return "medium";
		return "low";
	}

	// Use calculated score
	if (score > 15) return "high";
	if (score > 8) return "medium";
	return "low";
}

/**
 * Get patterns based on query type for more targeted extraction
 */
function getPatternsForQueryType(
	queryType: string
): Array<{ pattern: RegExp; weight: number; label: string }> {
	const basePatterns = [
		// Name patterns (always relevant)
		{ pattern: /([A-Z][a-z]+\s+[A-Z][a-z]+)/g, weight: 2, label: "Name" },
		// File number patterns (always relevant)
		{ pattern: /file\s*no[:\s]*([^.!?]+)/gi, weight: 2, label: "File" },
		{ pattern: /fir\s*no[:\s]*([^.!?]+)/gi, weight: 2, label: "FIR" },
	];

	switch (queryType) {
		case "victim_suspect":
			return [
				...basePatterns,
				{ pattern: /victim[:\s]+([^.!?]+)/gi, weight: 5, label: "Victim" },
				{
					pattern: /complainant[:\s]+([^.!?]+)/gi,
					weight: 5,
					label: "Complainant",
				},
				{ pattern: /injured[:\s]+([^.!?]+)/gi, weight: 4, label: "Injured" },
				{ pattern: /suspect[:\s]+([^.!?]+)/gi, weight: 5, label: "Suspect" },
				{ pattern: /accused[:\s]+([^.!?]+)/gi, weight: 5, label: "Accused" },
				{
					pattern: /defendant[:\s]+([^.!?]+)/gi,
					weight: 4,
					label: "Defendant",
				},
			];
		case "victim_suspect_with_age":
			return [
				...basePatterns,
				{ pattern: /victim[:\s]+([^.!?]+)/gi, weight: 5, label: "Victim" },
				{
					pattern: /complainant[:\s]+([^.!?]+)/gi,
					weight: 5,
					label: "Complainant",
				},
				{ pattern: /injured[:\s]+([^.!?]+)/gi, weight: 4, label: "Injured" },
				{ pattern: /suspect[:\s]+([^.!?]+)/gi, weight: 5, label: "Suspect" },
				{ pattern: /accused[:\s]+([^.!?]+)/gi, weight: 5, label: "Accused" },
				{
					pattern: /defendant[:\s]+([^.!?]+)/gi,
					weight: 4,
					label: "Defendant",
				},
				{ pattern: /age[:\s]+(\d+)/gi, weight: 5, label: "Age" },
				{ pattern: /(\d+)\s*years?\s*old/gi, weight: 5, label: "Age" },
				{ pattern: /(\d+)\s*years?/gi, weight: 3, label: "Age" },
			];
		case "location":
			return [
				...basePatterns,
				{ pattern: /location[:\s]+([^.!?]+)/gi, weight: 5, label: "Location" },
				{ pattern: /place[:\s]+([^.!?]+)/gi, weight: 4, label: "Place" },
				{ pattern: /address[:\s]+([^.!?]+)/gi, weight: 4, label: "Address" },
				{ pattern: /where[:\s]+([^.!?]+)/gi, weight: 4, label: "Location" },
			];
		case "temporal":
			return [
				...basePatterns,
				{ pattern: /date[:\s]+([^.!?]+)/gi, weight: 5, label: "Date" },
				{ pattern: /time[:\s]+([^.!?]+)/gi, weight: 4, label: "Time" },
				{
					pattern: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,
					weight: 4,
					label: "Date",
				},
				{ pattern: /when[:\s]+([^.!?]+)/gi, weight: 4, label: "Time" },
			];
		case "demographic":
			return [
				...basePatterns,
				{ pattern: /age[:\s]+(\d+)/gi, weight: 5, label: "Age" },
				{ pattern: /(\d+)\s*years?\s*old/gi, weight: 5, label: "Age" },
				{ pattern: /(\d+)\s*years?/gi, weight: 3, label: "Age" },
			];
		case "statistical":
			return [
				...basePatterns,
				{ pattern: /(\d+)/g, weight: 3, label: "Number" },
				{ pattern: /count[:\s]+([^.!?]+)/gi, weight: 4, label: "Count" },
				{ pattern: /total[:\s]+([^.!?]+)/gi, weight: 4, label: "Total" },
			];
		default:
			return [
				...basePatterns,
				// General patterns for unknown query types
				{ pattern: /victim[:\s]+([^.!?]+)/gi, weight: 4, label: "Victim" },
				{ pattern: /suspect[:\s]+([^.!?]+)/gi, weight: 4, label: "Suspect" },
				{ pattern: /location[:\s]+([^.!?]+)/gi, weight: 3, label: "Location" },
				{ pattern: /date[:\s]+([^.!?]+)/gi, weight: 3, label: "Date" },
				{ pattern: /age[:\s]+(\d+)/gi, weight: 3, label: "Age" },
			];
	}
}

/**
 * Extract key information from a note based on query relevance
 */
function extractKeyInformation(
	note: string,
	queryWords: string[],
	query: string
): string {
	if (!note) return "";

	// Split note into sentences
	const sentences = note.split(/[.!?]+/).filter((s) => s.trim().length > 0);

	// Define patterns based on query type
	const queryType = analyzeQueryType(query);
	const patterns = getPatternsForQueryType(queryType);

	// Score sentences based on relevance
	const scoredSentences = sentences.map((sentence) => {
		const sentenceLower = sentence.toLowerCase();
		let score = 0;
		let extractedInfo: string[] = [];

		// Score based on query word matches
		queryWords.forEach((word) => {
			if (sentenceLower.includes(word)) {
				score += 3; // Higher weight for query matches
			}
		});

		// Score based on specific patterns
		patterns.forEach(({ pattern, weight, label }) => {
			const matches = sentence.match(pattern);
			if (matches) {
				score += weight;
				matches.forEach((match) => {
					extractedInfo.push(`${label}: ${match.trim()}`);
				});
			}
		});

		// Score based on relevance keywords
		const relevanceKeywords = [
			"victim",
			"suspect",
			"witness",
			"location",
			"place",
			"date",
			"time",
			"age",
			"name",
			"address",
			"phone",
			"incident",
			"crime",
			"case",
		];

		relevanceKeywords.forEach((keyword) => {
			if (sentenceLower.includes(keyword)) {
				score += 1;
			}
		});

		return {
			sentence: sentence.trim(),
			score,
			extractedInfo,
			hasRelevantInfo: extractedInfo.length > 0,
		};
	});

	// Filter and sort by score, prioritize sentences with extracted info
	const relevantSentences = scoredSentences
		.filter((item) => item.score > 0 || item.hasRelevantInfo)
		.sort((a, b) => {
			// Prioritize sentences with extracted info
			if (a.hasRelevantInfo && !b.hasRelevantInfo) return -1;
			if (!a.hasRelevantInfo && b.hasRelevantInfo) return 1;
			// Then sort by score
			return b.score - a.score;
		})
		.slice(0, 5); // Keep top 5 most relevant sentences

	// If we have sentences with extracted info, return those
	const sentencesWithExtractedInfo = relevantSentences.filter(
		(item) => item.hasRelevantInfo
	);
	if (sentencesWithExtractedInfo.length > 0) {
		return (
			sentencesWithExtractedInfo.map((item) => item.sentence).join(". ") + "."
		);
	}

	// If no relevant sentences found, return a very short summary
	if (relevantSentences.length === 0) {
		return `[Summary] ${note.substring(0, 100)}${
			note.length > 100 ? "..." : ""
		}`;
	}

	// Return relevant sentences
	return relevantSentences.map((item) => item.sentence).join(". ") + ".";
}

/**
 * Extract minimal information for low relevance records
 */
function extractMinimalInformation(
	note: string,
	queryWords: string[],
	query: string
): string {
	if (!note) return "";

	// Look for specific patterns that are always relevant
	const essentialPatterns = [
		/victim[:\s]+([^.!?]+)/gi,
		/suspect[:\s]+([^.!?]+)/gi,
		/accused[:\s]+([^.!?]+)/gi,
		/location[:\s]+([^.!?]+)/gi,
		/place[:\s]+([^.!?]+)/gi,
		/date[:\s]+([^.!?]+)/gi,
		/time[:\s]+([^.!?]+)/gi,
		/age[:\s]+(\d+)/gi,
		/(\d+)\s*years?\s*old/gi,
		/(\d+)\s*years?/gi, // More general age pattern
		/([A-Z][a-z]+\s+[A-Z][a-z]+)/g, // Names
	];

	const extractedInfo: string[] = [];

	essentialPatterns.forEach((pattern) => {
		const matches = note.match(pattern);
		if (matches) {
			matches.forEach((match) => {
				extractedInfo.push(match.trim());
			});
		}
	});

	// If we found essential info, return it
	if (extractedInfo.length > 0) {
		return `[Essential Info] ${extractedInfo.slice(0, 3).join(", ")}.`;
	}

	// Otherwise return a very short summary
	return `[Summary] ${note.substring(0, 50)}${note.length > 50 ? "..." : ""}`;
}

/**
 * Prepare context for AI with optional relevance extraction
 */
export function prepareContextForAI(
	records: SearchResult[],
	query?: string,
	useRelevanceExtraction: boolean = false
): string {
	const recordCount = records.length;
	console.log(
		`[CONTEXT-PREP] Processing ${recordCount} records for context generation`
	);
	if (records.length === 0) {
		return "No relevant records found in the database.";
	}

	// Apply relevance extraction if enabled
	let processedRecords = records;
	if (useRelevanceExtraction && query) {
		processedRecords = extractRelevantInformation(records, query);
		console.log(
			`[CONTEXT-PREP] Applied relevance extraction to reduce token usage`
		);

		// Add debugging for age-related queries
		const queryType = analyzeQueryType(query);
		if (queryType.includes("age") || query.toLowerCase().includes("age")) {
			console.log(`[CONTEXT-PREP] Age-related query detected: "${query}"`);
			console.log(`[CONTEXT-PREP] Query type: ${queryType}`);

			// Count how many records have age information
			const recordsWithAge = processedRecords.filter((record) => {
				const note = record.note || "";
				return (
					/age[:\s]+(\d+)/gi.test(note) ||
					/(\d+)\s*years?\s*old/gi.test(note) ||
					/(\d+)\s*years?/gi.test(note)
				);
			});
			console.log(
				`[CONTEXT-PREP] Records with age information: ${recordsWithAge.length}/${processedRecords.length}`
			);
		}
	}

	// Group records by category for smarter organization
	const recordsByCategory = processedRecords.reduce((acc, record) => {
		const category = record.category || "Uncategorized";
		if (!acc[category]) acc[category] = [];
		acc[category].push(record);
		return acc;
	}, {} as Record<string, SearchResult[]>);

	// Create a structured index of all records for quick reference
	const recordIndex = processedRecords.map((record, index) => ({
		id: record.id,
		file_no: record.file_no,
		title: record.title,
		category: record.category || "Uncategorized",
		date: record.entry_date_real?.toLocaleDateString() || "Unknown date",
		relevance: record.rank ? (record.rank * 100).toFixed(1) + "%" : "Unknown",
	}));

	// Build the full record details with optimized content
	const detailedRecords = processedRecords.map((record) => {
		let content = record.note || "No content available";

		// Avoid duplicating metadata if it's already in the note
		const fileNoPattern = new RegExp(
			`File No[^\\n]*${escapeRegExp(record.file_no)}`,
			"i"
		);
		const categoryPattern = new RegExp(
			`Category[^\\n]*${escapeRegExp(record.category)}`,
			"i"
		);
		const titlePattern = new RegExp(
			`Title[^\\n]*${escapeRegExp(record.title)}`,
			"i"
		);

		const hasMetadataPrefix =
			fileNoPattern.test(content.substring(0, 200)) ||
			categoryPattern.test(content.substring(0, 200)) ||
			titlePattern.test(content.substring(0, 200));

		return {
			id: record.id,
			file_no: record.file_no,
			title: record.title,
			category: record.category || "Uncategorized",
			date: record.entry_date_real?.toLocaleDateString() || "Unknown date",
			content: content,
			relevance: record.rank ? (record.rank * 100).toFixed(1) + "%" : "",
		};
	});

	// Build the optimized context
	return `
DATABASE CONTEXT:

=== OVERVIEW ===
Found ${processedRecords.length} relevant records from the database.
The records span ${Object.keys(recordsByCategory).length} categories.
Records are listed below ordered by relevance to your query.

=== RECORD INDEX ===
${recordIndex
	.map(
		(r, i) =>
			`[${i + 1}] File: ${r.file_no} | Title: ${r.title} | Category: ${
				r.category
			} | Date: ${r.date} | Relevance: ${r.relevance}`
	)
	.join("\n")}

=== FULL RECORD DETAILS ===
${detailedRecords
	.map(
		(record, index) => `
[RECORD ${index + 1}] (Relevance: ${record.relevance})
File: ${record.file_no}
Title: ${record.title}
Category: ${record.category}
Date: ${record.date}
Content: ${record.content}
---`
	)
	.join("\n")}

=== CATEGORY SUMMARY ===
${Object.entries(recordsByCategory)
	.map(([category, records]) => `${category}: ${records.length} records`)
	.join("\n")}

END OF DATABASE CONTEXT
`;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Simple utility to estimate token count for a text string
 * This is a very rough approximation - tokens are typically 4 characters on average in English
 */
function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Generate AI response using Gemini with conversation context
 */
export async function generateAIResponse(
	question: string,
	context: string,
	conversationHistory: ChatMessage[] = [],
	queryType: string = "specific_search",
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {}
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
	// Ensure queryType is one of the allowed types, default to specific_search
	const allowedQueryTypes = [
		"specific_search",
		"analytical_query",
		"follow_up",
		"elaboration",
		"general",
		"recent_files",
	];
	if (!allowedQueryTypes.includes(queryType)) {
		queryType = "specific_search";
	}
	const { client, keyId } = await getGeminiClient({
		provider: "gemini",
		keyId: opts.keyId,
	});
	const dbModels = await getActiveModelNames("gemini");
	const attemptModels = Array.from(
		new Set([opts.model, ...dbModels].filter(Boolean))
	);

	// Build conversation context for follow-up questions
	const recentHistory = conversationHistory.slice(-4); // Last 2 exchanges
	const historyContext =
		recentHistory.length > 0
			? `\nCONVERSATION HISTORY:\n${recentHistory
					.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
					.join("\n")}\n`
			: "";

	// Adjust prompt based on query type
	let roleInstructions = "";
	switch (queryType) {
		case "analytical_query":
			roleInstructions = `
- The user is asking an analytical question that requires summarizing or finding patterns across multiple records.
- Analyze all the provided database records to identify trends, frequencies, and key data points related to the user's question.
- Synthesize your findings into a clear, structured summary.
- Use counts, lists, and direct data points to support your analysis (e.g., 'The most common location is X, appearing 5 times.').
- Present the information in an easy-to-understand format.
`;
			break;
		case "follow_up":
			roleInstructions = `
- This is a follow-up question referring to previous conversation.
- Use both the conversation history and database records to answer.
- Connect the current question to previous context.
`;
			break;
		case "elaboration":
			roleInstructions = `
- The user wants more detailed information about previous results.
- Provide comprehensive details from the database records.
- Expand on the information with additional context.
`;
			break;
		case "recent_files":
			roleInstructions = `
- The user asked for recent/latest files.
- Present the files in a clear, organized manner.
- Include file numbers, titles, categories, and dates.
- Mention they are sorted by most recent first.
`;
			break;
		default: // specific_search and general
			roleInstructions = `
- Answer the user's specific question using the provided database records.
- Be factual and cite relevant information by referencing file numbers.
- Provide clear, organized information.
`;
	}

	const prompt = `You are a helpful AI assistant for the database system.\n\n${historyContext}\n\nCURRENT QUESTION: "${question}"\n\n${context}\n\nINSTRUCTIONS:\n${roleInstructions}\n\n- Always be professional and factual\n- If asked about specific cases, provide file numbers and relevant details\n- If no relevant information is found, say so clearly\n- Keep responses concise but informative\n- Use bullet points or numbered lists when presenting multiple items\n\nPlease provide a helpful response based on the database records above.`;

	let lastError: any = null;
	for (const modelName of attemptModels) {
		try {
			console.log(
				`[AI-GEN] Sending request to Gemini API, model=${modelName}, prompt size: ${prompt.length} characters`
			);
			const apiCallTiming = timeStart("Gemini API Call");
			const model = client.getGenerativeModel({ model: modelName as string });
			// Use Gemini native token counter for input tokens
			let inputTokens = 0;
			try {
				const countRes: any = await model.countTokens({
					contents: [
						{
							role: "user",
							parts: [{ text: prompt }],
						},
					],
				});
				inputTokens = (countRes?.totalTokens ??
					countRes?.totalTokenCount ??
					0) as number;
			} catch (e) {
				// Fallback to heuristic only if countTokens fails
				inputTokens = estimateTokenCount(prompt);
				console.warn("[AI-GEN] countTokens failed; using heuristic", e);
			}
			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			timeEnd("Gemini API Call", apiCallTiming);

			// Prefer usage metadata from Gemini for output tokens
			const usage: any = (response as any)?.usageMetadata;
			const outputTokens = (usage?.candidatesTokenCount ??
				usage?.totalTokenCount ??
				estimateTokenCount(text)) as number;

			devLog("AI response generated successfully", {
				inputTokens,
				outputTokens,
				modelName,
			});
			if (keyId) await recordKeyUsage(keyId, true);

			return {
				text: text,
				inputTokens,
				outputTokens,
			};
		} catch (error: any) {
			lastError = error;
			if (keyId) await recordKeyUsage(keyId, false);
			console.warn(`[AI-GEN] model attempt failed: ${modelName}`, error);
			continue;
		}
	}
	console.error("AI response generation error (all models failed):", lastError);
	if (lastError?.message && lastError.message.includes("429")) {
		throw new Error("RATE_LIMIT_EXCEEDED");
	}
	throw new Error("Failed to generate AI response.");
}

/**
 * Main chat function using enhanced search with conversation context
 */
export async function processChatMessageEnhanced(
	question: string,
	conversationHistory: ChatMessage[] = [],
	searchLimit?: number,
	useEnhancedSearch: boolean = true,
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {}
): Promise<{
	response: string;
	sources: Array<{
		id: number;
		file_no: string;
		title: string;
		relevance?: number;
	}>;
	searchQuery: string;
	searchMethod:
		| "hybrid"
		| "semantic_fallback"
		| "tsvector_only"
		| "recent_files";
	queryType: string;
	analysisUsed: boolean;
	tokenCount?: {
		input: number;
		output: number;
	};
	stats?: {
		tsvectorResults: number;
		semanticResults: number;
		finalResults: number;
	};
}> {
	console.log(`[ADMIN CHAT] User admin asked: "${question}"`);

	let analysisUsed = false;
	let queryForSearch = question;
	let queryType = "specific_search"; // Default
	let searchLimitForRecent = 10; // Default for recent files

	let analysisInputTokens = 0;
	let analysisOutputTokens = 0;
	try {
		const analysis = await analyzeQueryForSearch(
			question,
			conversationHistory,
			opts
		);
		console.log("[CHAT ANALYSIS] Processing query:", `"${question}"`);
		console.log(
			"[CHAT ANALYSIS] Conversation history length:",
			conversationHistory.length
		);
		console.log("[CHAT ANALYSIS] Query type:", analysis.queryType);
		console.log(
			"[CHAT ANALYSIS] Core search terms:",
			`"${analysis.coreSearchTerms}"`
		);
		console.log(
			"[CHAT ANALYSIS] Instructional terms:",
			`"${analysis.instructionalTerms}"`
		);
		console.log("[CHAT ANALYSIS] Context needed:", analysis.contextNeeded);

		analysisUsed = true;
		queryForSearch = analysis.coreSearchTerms;
		queryType = analysis.queryType;
		analysisInputTokens = analysis.inputTokens || 0;
		analysisOutputTokens = analysis.outputTokens || 0;
		console.log(
			`[TOKENS] Analysis phase — input: ${analysisInputTokens}, output: ${analysisOutputTokens}`
		);

		// Check for a number in instructional terms for recent files query
		if (analysis.queryType === "recent_files" && analysis.instructionalTerms) {
			const num = parseInt(analysis.instructionalTerms, 10);
			if (!isNaN(num)) {
				searchLimitForRecent = num;
			}
		}
	} catch (error) {
		console.error("Failed to analyze query with AI, using raw query.", error);
		// Fallback to using the raw question if analysis fails
		queryForSearch = question;
	}

	let records: SearchResult[] = [];
	let searchMethod:
		| "hybrid"
		| "semantic_fallback"
		| "tsvector_only"
		| "recent_files" = "hybrid";
	let searchStats;

	if (queryType === "recent_files") {
		records = await getRecentFiles(searchLimitForRecent);
		searchMethod = "recent_files";
		console.log(`[CHAT ANALYSIS] Found ${records.length} recent files.`);
	} else {
		// Use the new Hybrid Search Service
		// Determine effective search limit: prefer explicit argument; otherwise use admin-configured setting
		const configuredLimit = await getSettingInt("ai.search.limit", 30);
		let effectiveSearchLimit =
			Number.isFinite(searchLimit as any) && (searchLimit as number) > 0
				? Math.floor(searchLimit as number)
				: configuredLimit;
		// Clamp to sensible bounds
		if (effectiveSearchLimit < 1) effectiveSearchLimit = 1;
		if (effectiveSearchLimit > 200) effectiveSearchLimit = 200;

		const hybridSearchResponse = await HybridSearchService.search(
			queryForSearch,
			effectiveSearchLimit
		);
		records = hybridSearchResponse.results;
		searchMethod = hybridSearchResponse.searchMethod;
		searchStats = hybridSearchResponse.stats;

		console.log(
			`[CHAT ANALYSIS] Hybrid search completed. Method: ${searchMethod}, Found: ${records.length} records.`
		);
	}

	// Check if this is an analytical query that needs chunked processing
	const needsChunkedProcessing = false; // Normal processing is more efficient for all queries
	let aiResponse;
	let contextTime = 0;
	let aiTime = 0;
	let context = "";

	// Use normal processing for all queries (analytical and non-analytical)
	console.log(
		`[CHAT PROCESSING] Starting context preparation for ${records.length} records`
	);
	const contextTiming = timeStart("Context Preparation");

	// Use normal processing for all queries (relevance extraction disabled)
	context = prepareContextForAI(records, queryForSearch, false);

	contextTime = timeEnd("Context Preparation", contextTiming);
	console.log(`[CHAT PROCESSING] Context size: ${context.length} characters`);

	// Generate AI response
	console.log(`[CHAT PROCESSING] Starting AI response generation`);
	const aiTiming = timeStart("AI Response Generation");
	aiResponse = await generateAIResponse(
		question,
		context,
		conversationHistory,
		queryType,
		opts
	);
	aiTime = timeEnd("AI Response Generation", aiTiming);
	console.log(
		`[TOKENS] Response phase — input: ${aiResponse.inputTokens}, output: ${aiResponse.outputTokens}`
	);

	// Extract sources from the context that were used in the AI response
	console.log(`[CHAT PROCESSING] Starting source extraction`);
	const sourceTiming = timeStart("Source Extraction");
	const citedSources = records
		.filter((record) => {
			const response = aiResponse.text.toLowerCase();
			const fileNo = record.file_no.toLowerCase();
			const title = record.title.toLowerCase();

			// Check for direct file number mention
			if (response.includes(fileNo)) return true;

			// Check for title mention (partial match)
			const titleWords = title.split(" ").filter((word) => word.length > 3);
			if (titleWords.some((word) => response.includes(word))) return true;

			// Check for content keywords from the record
			if (record.note) {
				const noteWords = record.note
					.toLowerCase()
					.split(/\s+/)
					.filter(
						(word) =>
							word.length > 4 &&
							![
								"this",
								"that",
								"with",
								"from",
								"they",
								"were",
								"been",
								"have",
							].includes(word)
					)
					.slice(0, 10); // Check first 10 meaningful words

				if (noteWords.some((word) => response.includes(word))) return true;
			}

			return false;
		})
		.map((record) => ({
			id: record.id,
			file_no: record.file_no,
			title: record.title,
			relevance: record.combined_score || record.rank,
		}));

	const sourceTime = timeEnd("Source Extraction", sourceTiming);

	console.log(
		`[CHAT ANALYSIS] Generated response with ${citedSources.length} cited sources out of ${records.length} total records used in context.`
	);
	console.log(
		`[ADMIN CHAT] Response generated with ${citedSources.length} sources`
	);

	// Log overall processing time breakdown
	console.log(`[TIMING-SUMMARY] Post-search processing breakdown:`);
	console.log(`[TIMING-SUMMARY] - Context preparation: ${contextTime}ms`);
	console.log(`[TIMING-SUMMARY] - AI response generation: ${aiTime}ms`);
	console.log(`[TIMING-SUMMARY] - Source extraction: ${sourceTime}ms`);
	console.log(
		`[TIMING-SUMMARY] - Total post-search time: ${
			contextTime + aiTime + sourceTime
		}ms`
	);

	return {
		response: aiResponse.text,
		sources: citedSources,
		searchQuery: queryForSearch,
		searchMethod,
		queryType,
		analysisUsed,
		tokenCount: {
			input: (analysisInputTokens || 0) + (aiResponse.inputTokens || 0),
			output: (analysisOutputTokens || 0) + (aiResponse.outputTokens || 0),
		},
		stats: searchStats,
	};
}

/**
 * Update search vectors for all records (maintenance function)
 */
export async function updateSearchVectors(): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE file_list 
      SET search_vector = 
        setweight(to_tsvector('english', COALESCE(title, '')),   'A') ||
        setweight(to_tsvector('english', COALESCE(category, '')),'B') ||
        setweight(to_tsvector('english', COALESCE(note, '')),    'C') ||
        setweight(to_tsvector('english', COALESCE(file_no, '')), 'B')
      WHERE search_vector IS NULL OR note IS NOT NULL
    `;

		console.log("[SEARCH VECTORS] Updated search vectors for all records");
	} catch (error) {
		console.error("Error updating search vectors:", error);
		throw new Error("Failed to update search vectors");
	}
}
