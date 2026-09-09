import {
	getGeminiClient,
	recordKeyUsage,
	getActiveModelNames,
} from "@/lib/ai-key-store";
import { ChatMessage } from "./types";

const FALLBACK_MODELS = [
	"gemini-2.5-flash",
	"gemini-3-flash-preview",
	"gemini-flash-latest",
	"gemini-3.5-flash-lite",
];

function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4);
}

function buildPrompt(
	question: string,
	context: string,
	conversationHistory: ChatMessage[] = [],
	queryType: string = "specific_search"
): { prompt: string; systemInstructions: string } {
	const recentHistory = conversationHistory.slice(-4);
	const historyContext =
		recentHistory.length > 0
			? `\nCONVERSATION HISTORY:\n${recentHistory
					.map((msg) => {
						// Truncate long messages (especially prior AI responses) to keep prompt lean
						const content = msg.content.length > 300
							? msg.content.substring(0, 300) + "..."
							: msg.content;
						return `${msg.role.toUpperCase()}: ${content}`;
					})
					.join("\n")}\n`
			: "";

	let roleInstructions = "";
	switch (queryType) {
		case "analytical_query":
			roleInstructions = `
- The user is asking an analytical question that requires summarizing or identifying patterns across records.
- Analyze all provided database records to identify trends, frequencies, and key details.
- Synthesize findings into a clear, structured summary.
- Use counts, lists, and direct data points where applicable.`;
			break;
		case "follow_up":
			roleInstructions = `
- This is a follow-up question continuing the previous conversation.
- Connect the current question to the previous context using the provided database records.`;
			break;
		case "elaboration":
			roleInstructions = `
- The user wants more detailed information about previous results.
- Provide comprehensive details from the database records with depth.`;
			break;
		case "recent_files":
			roleInstructions = `
- The user asked for recent or latest files.
- Present the files in a clean, organized manner with file numbers, titles, categories, and dates.`;
			break;
		default:
			roleInstructions = `
- Answer the user's specific question directly using the provided database records.
- Do NOT append inline bracketed citations like "[File: 1]", "[File 1]", "[Record 1]", or "[1]" to your answers or bullet points. The user interface automatically presents referenced source documents separately at the bottom.`;
	}

	const prompt = `You are an expert AI assistant for the Smart Docs document archive and intelligence system.

=== DATABASE CONTEXT ===
${context}

=== CONVERSATION HISTORY ===
${historyContext}

=== USER QUESTION ===
"${question}"

=== INSTRUCTIONS ===
${roleInstructions}
- Always be professional, precise, and factual.
- Ground your answers strictly in the Database Context.
- CRITICAL: Never include inline file citations or bracketed reference tags like "[File: 1]", "[File 1]", "[Record 1]", or "[1]" anywhere in your response text. All source references are already rendered automatically in the UI.
- If an official government order number, notification number, or file reference is part of the actual record content (e.g. "Order No: No. A.22012/47/2025-CSW-DPAR"), mention it naturally within the prose without surrounding bracketed tags like "[File: 1]".
- For dates and numbers, write them cleanly using standard text (e.g. "28th July, 2026" instead of raw HTML tags like "28<sup>th</sup> July, 2026").
- If the requested information is not in the context, state that clearly without guessing.
- Use clean markdown formatting (headings, bullet points, bold key terms).

Answer:`;

	return { prompt, systemInstructions: roleInstructions };
}

/**
 * Generate AI response with streaming support via Gemini API.
 */
export async function* generateAIResponseStream(
	question: string,
	context: string,
	conversationHistory: ChatMessage[] = [],
	queryType: string = "specific_search",
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {}
): AsyncGenerator<
	| { type: "token"; text: string; model: string }
	| { type: "done"; tokenCount: { input: number; output: number }; model: string },
	void,
	unknown
> {
	const { prompt } = buildPrompt(question, context, conversationHistory, queryType);

	const { client, keyId } = await getGeminiClient({
		provider: "gemini",
		keyId: opts.keyId,
	});

	let dbModels: string[] = [];
	try {
		dbModels = await getActiveModelNames("gemini");
	} catch (e) {
		console.warn("[AI-STREAM] Failed to fetch active models from DB:", e);
	}

	// Model attempt sequence: preferred model -> DB models -> production fallback list
	const attemptModels = Array.from(
		new Set([opts.model, ...dbModels, ...FALLBACK_MODELS].filter(Boolean) as string[])
	);

	let lastError: any = null;

	for (const modelName of attemptModels) {
		try {
			console.log(`[AI-STREAM] Connecting to Gemini model: ${modelName}`);
			const model = client.getGenerativeModel({ model: modelName });

			let streamTimeoutTimer: NodeJS.Timeout | null = null;
			const timeoutPromise = new Promise<never>((_, reject) => {
				streamTimeoutTimer = setTimeout(() => {
					reject(new Error(`Model ${modelName} timed out waiting for first token (6000ms)`));
				}, 6000);
			});

			const result = await Promise.race([
				model.generateContentStream(prompt),
				timeoutPromise,
			]);

			const iterator = result.stream[Symbol.asyncIterator]();
			const firstItem = await Promise.race([iterator.next(), timeoutPromise]);
			if (streamTimeoutTimer) clearTimeout(streamTimeoutTimer);

			if (firstItem.done) {
				throw new Error(`Model ${modelName} returned empty stream`);
			}

			let fullText = "";
			const firstChunkText = firstItem.value.text();
			if (firstChunkText) {
				fullText += firstChunkText;
				yield { type: "token", text: firstChunkText, model: modelName };
			}

			while (true) {
				const nextItem = await iterator.next();
				if (nextItem.done) break;
				const chunkText = nextItem.value.text();
				if (chunkText) {
					fullText += chunkText;
					yield { type: "token", text: chunkText, model: modelName };
				}
			}

			// Estimate or compute token usage
			const inputTokens = estimateTokenCount(prompt);
			const outputTokens = estimateTokenCount(fullText);

			if (keyId) {
				recordKeyUsage(keyId, true).catch(() => {}); // fire-and-forget — don't block done event
			}

			yield {
				type: "done",
				tokenCount: { input: inputTokens, output: outputTokens },
				model: modelName,
			};
			return;
		} catch (error: any) {
			console.warn(`[AI-STREAM] Model ${modelName} failed, trying next fallback:`, error?.message || error);
			lastError = error;
			if (keyId) {
				recordKeyUsage(keyId, false).catch(() => {}); // fire-and-forget
			}
			continue;
		}
	}

	throw new Error(`Failed to generate streaming response: ${lastError?.message || lastError}`);
}

/**
 * Generate AI response (non-streaming fallback).
 */
export async function generateAIResponse(
	question: string,
	context: string,
	conversationHistory: ChatMessage[] = [],
	queryType: string = "specific_search",
	opts: { provider?: "gemini"; model?: string; keyId?: number } = {}
): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
	const { prompt } = buildPrompt(question, context, conversationHistory, queryType);

	const { client, keyId } = await getGeminiClient({
		provider: "gemini",
		keyId: opts.keyId,
	});

	let dbModels: string[] = [];
	try {
		dbModels = await getActiveModelNames("gemini");
	} catch (e) {
		console.warn("[AI-GEN] Failed to fetch active models from DB:", e);
	}

	const attemptModels = Array.from(
		new Set([opts.model, ...dbModels, ...FALLBACK_MODELS].filter(Boolean) as string[])
	);

	let lastError: any = null;

	for (const modelName of attemptModels) {
		try {
			console.log(`[AI-GEN] Calling Gemini model: ${modelName}`);
			const model = client.getGenerativeModel({ model: modelName });
			let genTimeoutTimer: NodeJS.Timeout | null = null;
			const timeoutPromise = new Promise<never>((_, reject) => {
				genTimeoutTimer = setTimeout(() => {
					reject(new Error(`Model ${modelName} timed out (8000ms)`));
				}, 8000);
			});

			const result = await Promise.race([
				model.generateContent(prompt),
				timeoutPromise,
			]);
			if (genTimeoutTimer) clearTimeout(genTimeoutTimer);
			const response = await result.response;
			const text = response.text() || "";

			const inputTokens = estimateTokenCount(prompt);
			const outputTokens = estimateTokenCount(text);

			if (keyId) {
				recordKeyUsage(keyId, true).catch(() => {});
			}

			return { text, inputTokens, outputTokens, model: modelName };
		} catch (error: any) {
			console.warn(`[AI-GEN] Model ${modelName} failed:`, error?.message || error);
			lastError = error;
			if (keyId) {
				recordKeyUsage(keyId, false).catch(() => {});
			}
			continue;
		}
	}

	throw new Error(`Failed to generate AI response: ${lastError?.message || lastError}`);
}
