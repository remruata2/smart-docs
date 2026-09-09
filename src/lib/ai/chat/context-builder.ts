import { prisma } from "@/lib/prisma";
import { SearchResult } from "./types";

/**
 * Fetch the most recent records ordered by entry_date_real descending.
 */
export async function getRecentFiles(limit: number = 10): Promise<SearchResult[]> {
	try {
		const records = await prisma.fileList.findMany({
			where: {
				entry_date_real: { not: null },
			},
			orderBy: {
				entry_date_real: "desc",
			},
			take: limit,
			select: {
				id: true,
				file_no: true,
				category: true,
				title: true,
				note: true,
				entry_date_real: true,
			},
		});

		return records.map((record) => ({
			id: record.id,
			file_no: record.file_no,
			category: record.category,
			title: record.title,
			note: record.note,
			entry_date_real: record.entry_date_real,
		}));
	} catch (error) {
		console.error("[CONTEXT-BUILDER] Error fetching recent files:", error);
		return [];
	}
}

/**
 * Prepare formatted database context string for the AI model.
 */
export function prepareContextForAI(
	records: SearchResult[],
	query?: string
): string {
	if (!records || records.length === 0) {
		return "No relevant records found in the database.";
	}

	// Cap to top 10 records to keep prompt lean and reduce Gemini prefill latency
	const topRecords = records.slice(0, 10);

	// Group records by category for structural clarity
	const recordsByCategory = topRecords.reduce((acc, record) => {
		const category = record.category || "Uncategorized";
		if (!acc[category]) acc[category] = [];
		acc[category].push(record);
		return acc;
	}, {} as Record<string, SearchResult[]>);

	// Full details (no separate index — avoids duplication of metadata)
	const detailedRecords = topRecords.map((record, index) => {
		const dateStr = record.entry_date_real
			? new Date(record.entry_date_real).toLocaleDateString()
			: "Unknown date";

		// Truncate overly long content to protect token budget
		const content = record.note
			? record.note.length > 1200
				? `${record.note.substring(0, 1200)}... [truncated]`
				: record.note
			: "No details available";

		return `
--- DOCUMENT ENTRY ${index + 1}: ${record.title} ---
File Number: ${record.file_no}
Category: ${record.category}
Date: ${dateStr}
Content:
${content}
---`;
	});

	return `DATABASE CONTEXT (${topRecords.length} relevant records found${records.length > 10 ? `, showing top 10 of ${records.length}` : ""}):

=== RECORD DETAILS ===
${detailedRecords.join("\n")}

=== CATEGORY SUMMARY ===
${Object.entries(recordsByCategory)
	.map(([cat, list]) => `${cat}: ${list.length} records`)
	.join("\n")}

END OF DATABASE CONTEXT
`;
}

