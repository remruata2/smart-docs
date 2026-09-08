export interface ChatSource {
	id: number;
	file_no: string;
	title: string;
	category?: string;
	relevance?: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: Date;
	sources?: ChatSource[];
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
	rank?: number;
	ts_rank?: number;
	semantic_similarity?: number;
	combined_score?: number;
}

export type ChatChunk = {
	type: "metadata" | "token" | "sources" | "done" | "progress" | "error";
	text?: string;
	sources?: ChatSource[];
	searchQuery?: string;
	searchMethod?: string;
	queryType?: string;
	tokenCount?: { input: number; output: number };
	stats?: {
		tsvectorResults: number;
		semanticResults: number;
		finalResults: number;
	};
	progress?: string;
	error?: string;
};
