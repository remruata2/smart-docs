// Use explicit file path to avoid ESM directory import issues under ts-node
import { PrismaClient } from "../generated/prisma/index.js";
import { getGeminiClient } from "./ai-key-store";

const prisma = new PrismaClient();

export class SemanticVectorService {
  /**
   * Generate 384-dimensional vector embedding using Gemini text-embedding-004.
   * Leverages Matryoshka Representation Learning (outputDimensionality: 384)
   * to match the existing Postgres vector(384) column without database migrations.
   */
  static async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const { client } = await getGeminiClient({ provider: "gemini" });
      const model = client.getGenerativeModel({ model: "text-embedding-004" });

      // Prepare text for embedding while preserving structure
      const preparedText = text
        .replace(/\n+/g, " ")
        .trim()
        .substring(0, 2048);

      if (!preparedText) {
        return null;
      }

      const result = await model.embedContent({
        content: { role: "user", parts: [{ text: preparedText }] },
        outputDimensionality: 384,
      } as any);

      if (!result?.embedding?.values) {
        return null;
      }

      return result.embedding.values;
    } catch (error) {
      console.warn(
        "[SEMANTIC] Gemini text-embedding-004 failed, falling back to keyword search:",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  static async updateSemanticVector(fileId: number, content: string) {
    try {
      if (!content || content.trim().length === 0) {
        console.log(
          `Skipping semantic vector update for file ${fileId} - no content`
        );
        return;
      }

      const embedding = await this.generateEmbedding(content);
      if (!embedding) {
        console.log(
          `Skipping semantic vector update for file ${fileId} - embedder not available`
        );
        return;
      }

      await prisma.$executeRaw`
        UPDATE file_list 
        SET semantic_vector = ${embedding}::vector
        WHERE id = ${fileId}
      `;

      console.log(`✅ Updated semantic vector for file ${fileId}`);
    } catch (error) {
      console.error(
        `❌ Failed to update semantic vector for file ${fileId}:`,
        error
      );
      throw error;
    }
  }

  static async semanticSearch(
    query: string,
    limit: number = 10
  ): Promise<any[]> {
    try {
      const queryEmbedding = await this.generateEmbedding(query);
      if (!queryEmbedding) {
        return [];
      }
      const SIMILARITY_THRESHOLD = 0.3; // Only return results with >30% similarity

      const results = (await prisma.$queryRaw`
        SELECT 
          id,
          file_no,
          category,
          title,
          note,
          entry_date_real,
          1 - (semantic_vector <=> ${queryEmbedding}::vector) as similarity
        FROM file_list 
        WHERE semantic_vector IS NOT NULL
          AND (1 - (semantic_vector <=> ${queryEmbedding}::vector)) > ${SIMILARITY_THRESHOLD}
        ORDER BY semantic_vector <=> ${queryEmbedding}::vector
      `) as any[];

      console.log(
        `🔍 Semantic search found ${results.length} results for query: "${query}" (threshold: ${SIMILARITY_THRESHOLD}, no limit)`
      );

      // Log similarity scores for debugging
      if (results.length > 0) {
        console.log(
          `   Similarity scores: ${results
            .map((r) => `${r.file_no}:${(r.similarity * 100).toFixed(1)}%`)
            .join(", ")}`
        );
      }

      return results;
    } catch (error) {
      console.error("Semantic search error:", error);
      return [];
    }
  }

  static async batchUpdateSemanticVectors(forceAll: boolean = false) {
    try {
      console.log(`🔄 Starting batch semantic vector update (forceAll=${forceAll})...`);

      // Count rows missing semantic_vector before
      const missingBeforeRes = (await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM file_list WHERE semantic_vector IS NULL`
      )) as Array<{ c: number }>;
      const missingBefore = missingBeforeRes[0]?.c ?? 0;
      console.log(`📊 Missing semantic_vector before: ${missingBefore}`);

      // Fetch rows: either all or only missing
      const sql = forceAll
        ? `SELECT id, note, title, category, file_no, entry_date FROM file_list`
        : `SELECT id, note, title, category, file_no, entry_date FROM file_list WHERE semantic_vector IS NULL`;

      const records = (await prisma.$queryRawUnsafe(sql)) as Array<{
        id: number;
        note: string | null;
        title?: string | null;
        category?: string | null;
        file_no?: string | null;
        entry_date?: string | null;
      }>;

      console.log(`📦 Rows to process: ${records.length}`);

      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        // Build fallback content: prefer note (rich), else plain text, then metadata
        const parts = [r.note, r.title, r.category, r.file_no, r.entry_date]
          .filter((v) => !!v && String(v).trim().length > 0) as string[];
        const content = parts.join(" ").trim();

        if (content.length === 0) {
          console.log(
            `Skipping file ${r.id} — no usable text (note/title/category/file_no all empty)`
          );
          continue;
        }

        await this.updateSemanticVector(r.id, content);

        if ((i + 1) % 5 === 0 || i === records.length - 1) {
          console.log(`Progress: ${i + 1}/${records.length} records processed`);
        }

        // Small 100ms pause to respect API rate limits
        if (i < records.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Count rows missing semantic_vector after
      const missingAfterRes = (await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM file_list WHERE semantic_vector IS NULL`
      )) as Array<{ c: number }>;
      const missingAfter = missingAfterRes[0]?.c ?? 0;
      console.log(`✅ Batch semantic vector update completed. Remaining NULL: ${missingAfter}`);
    } catch (error) {
      console.error("❌ Batch update failed:", error);
      throw error;
    }
  }
}
