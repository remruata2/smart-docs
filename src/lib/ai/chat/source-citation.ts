import { ChatSource, SearchResult } from "./types";

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract cited sources from the AI response and matched database records.
 */
export function extractCitedSources(
	response: string,
	records: SearchResult[]
): ChatSource[] {
	if (!records || records.length === 0) {
		return [];
	}

	const citedSources: ChatSource[] = [];
	const seenIds = new Set<number>();

	// 1. Direct file_no match in the response
	for (const record of records) {
		if (!record.file_no) continue;
		
		const escapedFileNo = escapeRegExp(record.file_no);
		// Check for file number mentioned as word or bracketed
		const pattern = new RegExp(`\\b${escapedFileNo}\\b|\\[${escapedFileNo}\\]`, "i");

		if (pattern.test(response) && !seenIds.has(record.id)) {
			seenIds.add(record.id);
			citedSources.push({
				id: record.id,
				file_no: record.file_no,
				title: record.title,
				category: record.category,
				relevance: record.combined_score || record.rank,
			});
		}
	}

	// 2. Title substring match (if title is meaningful, > 5 chars)
	for (const record of records) {
		if (seenIds.has(record.id)) continue;
		if (!record.title || record.title.length < 5) continue;

		const cleanTitle = record.title.trim();
		const escapedTitle = escapeRegExp(cleanTitle);
		const titlePattern = new RegExp(`\\b${escapedTitle}\\b`, "i");

		if (titlePattern.test(response)) {
			seenIds.add(record.id);
			citedSources.push({
				id: record.id,
				file_no: record.file_no,
				title: record.title,
				category: record.category,
				relevance: record.combined_score || record.rank,
			});
		}
	}

	// 3. If no explicit citations were matched in the text, provide the top relevant records as context sources
	if (citedSources.length === 0 && records.length > 0) {
		const topRecords = records.slice(0, Math.min(records.length, 5));
		for (const record of topRecords) {
			if (!seenIds.has(record.id)) {
				seenIds.add(record.id);
				citedSources.push({
					id: record.id,
					file_no: record.file_no,
					title: record.title,
					category: record.category,
					relevance: record.combined_score || record.rank,
				});
			}
		}
	}

	return citedSources;
}
