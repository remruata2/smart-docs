import { ChatChunk, ChatMessage, SearchResult } from "./types";
import { generateAIResponseStream, generateAIResponse } from "./response-generator";
import { prepareContextForAI, getRecentFiles } from "./context-builder";
import { extractCitedSources } from "./source-citation";
import { HybridSearchService } from "@/lib/hybrid-search";
import { getSettingInt } from "@/lib/app-settings";

/**
 * Rephrase follow-up queries into standalone search terms without an extra AI call.
 * If the current query is short and references pronouns/follow-up markers,
 * prepends context from the last user message so hybrid search finds the relevant files.
 */
export function deriveSearchQuery(
	question: string,
	history: ChatMessage[] = []
): { searchQuery: string; queryType: string; isFollowUp: boolean } {
	const q = question.trim();
	const lq = q.toLowerCase();

	// Check if this is a recent files query
	if (
		/\b(recent|latest|newest|last|most recent)\s+(files?|records?|cases?|entries?)\b/i.test(lq) ||
		/\b\d+\s+(recent|latest|newest|last|most recent)\b/i.test(lq)
	) {
		return { searchQuery: q, queryType: "recent_files", isFollowUp: false };
	}

	// Check for analytical queries
	const isAnalytical =
		/\b(summarize|summary|analyze|analysis|compare|comparison|trend|pattern|patterns|statistics|how many|most common|overview|breakdown)\b/i.test(
			lq
		);

	// Strip conversational question preambles to extract core search query
	const cleanedTopic = q
		.replace(
			/^(what|which|who|where|when|can you|do you|please|could you|tell me|give me|show me|find|search for)\s+(files?|cases?|records?|information|details|anything)?\s*(do you have\s*)?(about|on|for|regarding|in)?\s*/i,
			""
		)
		.replace(/[?.!]+$/, "")
		.trim();

	const baseQuery = cleanedTopic.length >= 2 ? cleanedTopic : q;

	const isShortFollowUp =
		question.length < 80 &&
		(/\b(it|this|that|these|those|them|he|she|they|him|her)\b/i.test(lq) ||
			/^(more|again|also|and|but|elaborate|expand|explain|describe|tell me more|what about|why|how|give|show)\b/i.test(
				lq
			) ||
			(lq.endsWith("?") && lq.split(" ").length <= 4));

	if (isShortFollowUp && history.length > 0) {
		const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
		if (lastUserMsg) {
			const cleanTopic = lastUserMsg.content
				.replace(
					/^(what is|what are|tell me about|explain|describe|how does|why is|how do|show me|find|search for|details of|case)\s+/i,
					""
				)
				.replace(/[?.!]$/, "")
				.substring(0, 100)
				.trim();

			if (cleanTopic && !lq.includes(cleanTopic.toLowerCase())) {
				console.log(`[QUERY-DERIVE] Prepending previous topic: "${cleanTopic}" to "${baseQuery}"`);
				return {
					searchQuery: `${cleanTopic} ${baseQuery}`.trim(),
					queryType: isAnalytical ? "analytical_query" : "follow_up",
					isFollowUp: true,
				};
			}
		}
	}

	return {
		searchQuery: baseQuery,
		queryType: isAnalytical ? "analytical_query" : "specific_search",
		isFollowUp: false,
	};
}

/**
 * Main streaming AI chat function.
 * Yields event chunks progressively: metadata -> progress -> token(s) -> sources -> done
 */
export async function* processChat(
	question: string,
	conversationHistory: ChatMessage[] = [],
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {},
	searchLimit?: number
): AsyncGenerator<ChatChunk, void, unknown> {
	const q = question.trim();
	const lq = q.toLowerCase();

	// 1. Fast Greeting Bypass (0ms latency, no LLM call required)
	if (
		/^(hi|hello|hey|good\s+(morning|evening|afternoon)|who are you|what can you do|help me|greetings)\b/i.test(
			lq
		) &&
		q.length < 30
	) {
		yield {
			type: "token",
			text: "Hello! I am your AI assistant for Smart Docs. You can ask me about documents, file numbers, categories, records, or ask for summaries.",
		};
		yield {
			type: "done",
			tokenCount: { input: 0, output: 0 },
		};
		return;
	}

	// 2. Derive Search Query & Query Type in 0ms
	const { searchQuery, queryType } = deriveSearchQuery(q, conversationHistory);
	console.log(`[CHAT] Derived query: "${searchQuery}", type: ${queryType}`);

	let records: SearchResult[] = [];
	let searchMethod = "hybrid";
	let searchStats = undefined;

	// 3. Retrieve Records
	if (queryType === "recent_files") {
		// Extract count if specified (e.g. "recent 5 files")
		const countMatch = q.match(/\b(\d+)\s+(recent|latest|newest|last|most recent)\b/i);
		const limit = countMatch ? parseInt(countMatch[1], 10) : 10;
		yield {
			type: "progress",
			progress: "Fetching recent archive files...",
		};
		records = await getRecentFiles(limit);
		searchMethod = "recent_files";
	} else {
		yield {
			type: "progress",
			progress: "Searching document records...",
		};

		const configuredLimit = await getSettingInt("ai.search.limit", 20);
		const effectiveLimit = searchLimit && searchLimit > 0 ? searchLimit : configuredLimit;

		const searchResponse = await HybridSearchService.search(searchQuery, effectiveLimit);
		records = searchResponse.results;
		searchMethod = searchResponse.searchMethod;
		searchStats = searchResponse.stats;
	}

	// 4. Send Metadata Event
	yield {
		type: "metadata",
		searchQuery,
		searchMethod,
		queryType,
		stats: searchStats,
	};

	yield {
		type: "progress",
		progress: `Synthesizing answer from ${records.length} record(s)...`,
	};

	// 5. Prepare Context
	const context = prepareContextForAI(records, searchQuery);

	// 6. Stream Model Tokens
	let fullText = "";
	let tokenCount = { input: 0, output: 0 };

	for await (const chunk of generateAIResponseStream(
		q,
		context,
		conversationHistory,
		queryType,
		opts
	)) {
		if (chunk.type === "token") {
			fullText += chunk.text;
			yield { type: "token", text: chunk.text };
		} else if (chunk.type === "done") {
			tokenCount = chunk.tokenCount;
		}
	}

	// 7. Extract Cited Sources
	const sources = extractCitedSources(fullText, records);
	yield {
		type: "sources",
		sources,
	};

	// 8. Stream Completed
	yield {
		type: "done",
		tokenCount,
	};
}

/**
 * Non-streaming wrapper for backward-compatible API consumers.
 */
export async function processChatMessage(
	question: string,
	conversationHistory: ChatMessage[] = [],
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {},
	searchLimit?: number
): Promise<{
	response: string;
	sources: SearchResult[];
	searchQuery: string;
	searchMethod: string;
	queryType: string;
	tokenCount: { input: number; output: number };
}> {
	let fullText = "";
	let sources: any[] = [];
	let searchQuery = question;
	let searchMethod = "hybrid";
	let queryType = "specific_search";
	let tokenCount = { input: 0, output: 0 };

	for await (const chunk of processChat(question, conversationHistory, opts, searchLimit)) {
		if (chunk.type === "metadata") {
			searchQuery = chunk.searchQuery || searchQuery;
			searchMethod = chunk.searchMethod || searchMethod;
			queryType = chunk.queryType || queryType;
		} else if (chunk.type === "token") {
			fullText += chunk.text || "";
		} else if (chunk.type === "sources") {
			sources = chunk.sources || [];
		} else if (chunk.type === "done") {
			tokenCount = chunk.tokenCount || tokenCount;
		}
	}

	return {
		response: fullText,
		sources,
		searchQuery,
		searchMethod,
		queryType,
		tokenCount,
	};
}
