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
 * Fetch all categories and their document counts, plus representative files for each category.
 */
export async function getCategorySummaryFiles(limitPerCategory: number = 10): Promise<{
	categories: Array<{ category: string; count: number }>;
	records: SearchResult[];
}> {
	try {
		// 1. Fetch all distinct categories and their exact counts
		const categoryCounts = (await prisma.$queryRawUnsafe(`
			SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') as category, COUNT(*)::int as count
			FROM file_list
			GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
			ORDER BY count DESC
		`)) as Array<{ category: string; count: number }>;

		// 2. Fetch records across each category
		const records: SearchResult[] = [];
		for (const cat of categoryCounts) {
			const catRecords = await prisma.fileList.findMany({
				where: cat.category === "Uncategorized"
					? { category: "" }
					: { category: cat.category },
				orderBy: { entry_date_real: "desc" },
				take: limitPerCategory,
				select: {
					id: true,
					file_no: true,
					category: true,
					title: true,
					note: true,
					entry_date_real: true,
				},
			});

			records.push(...catRecords.map((r) => ({
				id: r.id,
				file_no: r.file_no,
				category: r.category || "Uncategorized",
				title: r.title,
				note: r.note,
				entry_date_real: r.entry_date_real,
			})));
		}

		return { categories: categoryCounts, records };
	} catch (error) {
		console.error("[CONTEXT-BUILDER] Error fetching category summary:", error);
		return { categories: [], records: [] };
	}
}

/**
 * Prepare formatted database context string for the AI model.
 */
export function prepareContextForAI(
	records: SearchResult[],
	query?: string,
	categoryCounts?: Array<{ category: string; count: number }>
): string {
	if (!records || records.length === 0) {
		return "No relevant records found in the database.";
	}

	// Include up to 20 relevant records from search results to ensure comprehensive coverage
	const topRecords = records.slice(0, 20);

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

		// Include full document content without character truncation
		const content = record.note || "No details available";

		return `
--- DOCUMENT ENTRY ${index + 1}: ${record.title} ---
File Number: ${record.file_no}
Category: ${record.category}
Date: ${dateStr}
Content:
${content}
---`;
	});

	const categoryOverview = categoryCounts && categoryCounts.length > 0
		? categoryCounts.map((c) => `- ${c.category}: ${c.count} total records in archive`).join("\n")
		: Object.entries(recordsByCategory)
				.map(([cat, list]) => `${cat}: ${list.length} records`)
				.join("\n");

	return `DATABASE CONTEXT (${topRecords.length} relevant records found${records.length > topRecords.length ? `, showing top ${topRecords.length} of ${records.length}` : ""}):

=== CATEGORIES IN ARCHIVE ===
${categoryOverview}

=== RECORD DETAILS ===
${detailedRecords.join("\n")}

END OF DATABASE CONTEXT
`;
}

