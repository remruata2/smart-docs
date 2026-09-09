import { PrismaClient } from "../generated/prisma";
import { SemanticVectorService } from "./semantic-vector";

const prisma = new PrismaClient();

export interface HybridSearchResult {
  id: number;
  file_no: string;
  category: string;
  title: string;
  note: string;
  entry_date_real: Date | null;
  ts_rank?: number;
  semantic_similarity?: number;
  combined_score?: number;
}

export class HybridSearchService {
  /**
   * The Hybrid Search Recipe Implementation
   *
   * Step 1: Fast Keyword Filter (tsvector) - Pre-filter candidates
   * Step 2: Semantic Re-Ranker (pgvector) - Rank by meaning
   * Step 3: Intelligent Fallback - Full semantic search if no tsvector results
   */
  static async search(
    query: string,
    limit: number = 20
  ): Promise<{
    results: HybridSearchResult[];
    searchMethod: "hybrid" | "semantic_fallback" | "tsvector_only";
    stats: {
      tsvectorResults: number;
      semanticResults: number;
      finalResults: number;
    };
  }> {
    try {
      console.log(`[HYBRID SEARCH] Starting search for: "${query}"`);

      // Step 1: The Fast Keyword Filter (tsvector)
      const tsvectorResults = await this.tsvectorSearch(query);

      console.log(
        `[HYBRID SEARCH] Step 1 - tsvector found ${tsvectorResults.length} candidates`
      );

      if (tsvectorResults.length === 0) {
        try {
          console.log(
            "[HYBRID SEARCH] Step 3 - Attempting intelligent fallback (semantic search)"
          );
          const semanticResults = await SemanticVectorService.semanticSearch(
            query,
            limit
          );

          if (semanticResults && semanticResults.length > 0) {
            return {
              results: semanticResults.map((result) => ({
                ...result,
                semantic_similarity: result.similarity,
                combined_score: result.similarity,
              })),
              searchMethod: "semantic_fallback",
              stats: {
                tsvectorResults: 0,
                semanticResults: semanticResults.length,
                finalResults: semanticResults.length,
              },
            };
          }
        } catch (semanticErr) {
          console.warn(
            "[HYBRID SEARCH] Semantic search unavailable, falling back to keyword search"
          );
        }

        // Resilient keyword text fallback (ILIKE across fields)
        const textResults = await this.textFallbackSearch(query, limit);
        return {
          results: textResults,
          searchMethod: "tsvector_only",
          stats: {
            tsvectorResults: 0,
            semanticResults: 0,
            finalResults: textResults.length,
          },
        };
      }

      // Step 2: The Semantic Re-Ranker (pgvector)
      const candidateIds = tsvectorResults.map((r) => r.id);
      const semanticResults = await this.semanticSearchOnCandidates(
        query,
        candidateIds,
        limit
      );

      console.log(
        `[HYBRID SEARCH] Step 2 - semantic re-ranking on ${candidateIds.length} candidates`
      );

      // Combine and rank results using hybrid scoring
      const combinedResults = this.combineAndRankResults(
        tsvectorResults,
        semanticResults,
        limit
      );

      console.log(`[HYBRID SEARCH] Final results: ${combinedResults.length}`);

      return {
        results: combinedResults,
        searchMethod: "hybrid",
        stats: {
          tsvectorResults: tsvectorResults.length,
          semanticResults: semanticResults.length,
          finalResults: combinedResults.length,
        },
      };
    } catch (error) {
      console.error("[HYBRID SEARCH] Error:", error);

      // Fallback to tsvector only
      console.log("[HYBRID SEARCH] Error fallback - using tsvector only");
      const fallbackResults = await this.tsvectorSearch(query);
      return {
        results: fallbackResults,
        searchMethod: "tsvector_only",
        stats: {
          tsvectorResults: fallbackResults.length,
          semanticResults: 0,
          finalResults: fallbackResults.length,
        },
      };
    }
  }

  private static async tsvectorSearch(
    query: string,
    limit?: number
  ): Promise<HybridSearchResult[]> {
    // Use web-style tsquery; add structured filters and cap candidates
    const rawQuery = (query || "").trim();
    if (!rawQuery) return [];

    // Extract file number like "File No A-20" or variants
    const fileNoMatch = rawQuery.match(/file\s*no\.?\s*([A-Za-z0-9\-\/]+)/i);
    const fileNo = fileNoMatch ? fileNoMatch[1] : undefined;

    // Optional: if user provides a quoted phrase, use it to narrow title
    const quoteMatch = rawQuery.match(/"([^"]+)"/);
    const titlePhrase = quoteMatch ? quoteMatch[1] : undefined;

    // Build SQL with dynamic filters and LIMIT
    const params: any[] = [];
    const tsParamIndex = 1;
    params.push(rawQuery); // $1 for websearch_to_tsquery

    let sql = `
      SELECT 
        id,
        file_no,
        category,
        title,
        note,
        entry_date_real,
        ts_rank(search_vector, websearch_to_tsquery('english', $${tsParamIndex})) as ts_rank
      FROM file_list 
      WHERE search_vector @@ websearch_to_tsquery('english', $${tsParamIndex})`;

    let nextIndex = tsParamIndex + 1;
    if (fileNo) {
      sql += ` AND file_no ILIKE '%' || $${nextIndex} || '%'
      `;
      params.push(fileNo);
      nextIndex++;
    }
    if (titlePhrase) {
      sql += ` AND title ILIKE '%' || $${nextIndex} || '%'
      `;
      params.push(titlePhrase);
      nextIndex++;
    }

    const cap = 1000;
    sql += `
      ORDER BY ts_rank DESC, entry_date_real DESC
      LIMIT $${nextIndex}
    `;
    params.push(cap);

    console.log(
      `[TSVECTOR] Query: "${rawQuery}" | filters: { file_no: ${fileNo ?? "-"}, titlePhrase: ${titlePhrase ?? "-"} } | cap: ${cap}`
    );

    const results = (await prisma.$queryRawUnsafe(sql, ...params)) as HybridSearchResult[];

    console.log(
      `[TSVECTOR] Found ${results.length} records (capped at ${cap})`
    );
    return results;
  }

  private static async semanticSearchOnCandidates(
    query: string,
    candidateIds: number[],
    limit: number
  ): Promise<HybridSearchResult[]> {
    // If 0 or only 1 candidate found, no re-ranking is needed
    if (candidateIds.length <= 1) return [];

    const queryEmbedding = await SemanticVectorService.generateEmbedding(query);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.log(`[SEMANTIC] Embedder unavailable, skipping re-ranking`);
      return [];
    }

    console.log(`[SEMANTIC] Re-ranking ${candidateIds.length} candidates via Gemini text-embedding-004`);

    const results = (await prisma.$queryRawUnsafe(
      `
      SELECT 
        id,
        file_no,
        category,
        title,
        note,
        entry_date_real,
        1 - (semantic_vector <=> $1::vector) as semantic_similarity
      FROM file_list 
      WHERE id = ANY($2) AND semantic_vector IS NOT NULL
      ORDER BY semantic_vector <=> $1::vector
      LIMIT $3
    `,
      queryEmbedding,
      candidateIds,
      limit
    )) as HybridSearchResult[];

    return results;
  }

  private static combineAndRankResults(
    tsvectorResults: HybridSearchResult[],
    semanticResults: HybridSearchResult[],
    limit: number
  ): HybridSearchResult[] {
    // Create a map of results by ID
    const resultMap = new Map<number, HybridSearchResult>();

    // Add tsvector results with initial scoring (60% weight)
    tsvectorResults.forEach((result) => {
      resultMap.set(result.id, {
        ...result,
        combined_score: (result.ts_rank || 0) * 0.6,
      });
    });

    // Add semantic results and update scores (40% weight)
    semanticResults.forEach((result) => {
      const existing = resultMap.get(result.id);
      if (existing) {
        // Hybrid score: 60% tsvector + 40% semantic
        existing.semantic_similarity = result.semantic_similarity;
        existing.combined_score =
          (existing.ts_rank || 0) * 0.6 +
          (result.semantic_similarity || 0) * 0.4;
      } else {
        // Semantic-only result (shouldn't happen in normal flow, but safety net)
        resultMap.set(result.id, {
          ...result,
          combined_score: (result.semantic_similarity || 0) * 0.4,
        });
      }
    });

    // Sort by combined score and return top results
    const finalResults = Array.from(resultMap.values())
      .sort((a, b) => (b.combined_score || 0) - (a.combined_score || 0))
      .slice(0, limit);

    console.log(
      `[HYBRID] Combined scoring completed: ${finalResults.length} results`
    );

    // Detailed logging for debugging
    console.log(
      "[HYBRID-DEBUG] Initial tsvector results:",
      tsvectorResults.map((r) => ({ id: r.id, ts_rank: r.ts_rank }))
    );
    console.log(
      "[HYBRID-DEBUG] Semantic re-ranking results:",
      semanticResults.map((r) => ({
        id: r.id,
        semantic_similarity: r.semantic_similarity,
      }))
    );
    console.log(
      "[HYBRID-DEBUG] Final combined and sorted results:",
      finalResults.map((r) => ({ id: r.id, combined_score: r.combined_score }))
    );

    return finalResults;
  }

  private static async textFallbackSearch(
    query: string,
    limit: number = 20
  ): Promise<HybridSearchResult[]> {
    const raw = (query || "").trim();
    if (!raw) return [];

    const words = raw
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, "").trim())
      .filter((w) => w.length >= 2);

    if (words.length === 0) return [];

    const conditions = words.map(
      (_, i) => `(title ILIKE '%' || $${i + 1} || '%' OR file_no ILIKE '%' || $${i + 1} || '%' OR category ILIKE '%' || $${i + 1} || '%' OR note ILIKE '%' || $${i + 1} || '%')`
    );

    const sql = `
      SELECT id, file_no, category, title, note, entry_date_real, 0.5 as ts_rank
      FROM file_list
      WHERE ${conditions.join(" OR ")}
      ORDER BY entry_date_real DESC NULLS LAST
      LIMIT $${words.length + 1}
    `;

    try {
      return (await prisma.$queryRawUnsafe(sql, ...words, limit)) as HybridSearchResult[];
    } catch (e) {
      console.warn("[HYBRID SEARCH] Text fallback error:", e);
      return [];
    }
  }
}
