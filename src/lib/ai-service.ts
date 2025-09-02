import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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
}

/**
 * Search the database for relevant records based on the query
 */
export async function searchDatabase(
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  try {
    const searchTerms = query
      .toLowerCase()
      .split(" ")
      .filter((term) => term.length > 2);

    const records = await prisma.fileList.findMany({
      where: {
        OR: [
          ...searchTerms.map((term) => ({
            note: { contains: term, mode: "insensitive" as const },
          })),
          ...searchTerms.map((term) => ({
            title: { contains: term, mode: "insensitive" as const },
          })),
          ...searchTerms.map((term) => ({
            category: { contains: term, mode: "insensitive" as const },
          })),
          ...searchTerms.map((term) => ({
            file_no: { contains: term, mode: "insensitive" as const },
          })),
        ],
      },
      select: {
        id: true,
        file_no: true,
        category: true,
        title: true,
        note: true,
        entry_date_real: true,
      },
      take: limit,
      orderBy: { entry_date_real: "desc" },
    });

    return records;
  } catch (error) {
    console.error("Database search error:", error);
    throw new Error("Failed to search database");
  }
}

/**
 * Prepare context for AI from database records
 */
function prepareContextForAI(records: SearchResult[]): string {
  if (records.length === 0) {
    return "No relevant records found in the database.";
  }

  const context = records.map((record) => ({
    id: record.id,
    source: `File: ${record.file_no}`,
    title: record.title,
    category: record.category,
    content: record.note || "No content available",
    date: record.entry_date_real?.toLocaleDateString() || "Unknown date",
  }));

  return `
DATABASE CONTEXT:
Found ${records.length} relevant records from the database:

${context
  .map(
    (record, index) => `
[RECORD ${index + 1}]
File: ${record.source}
Title: ${record.title}
Category: ${record.category}
Date: ${record.date}
Content: ${record.content}
---`
  )
  .join("\n")}

END OF DATABASE CONTEXT
`;
}

/**
 * Generate AI response using Gemini
 */
export async function generateAIResponse(
  question: string,
  context: string
): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `You are an AI assistant for the database query system. 

Your role is to:
- Answer questions based ONLY on the provided database records
- Be accurate and cite specific file references when possible
- If the information is not in the provided context, clearly state that
- Use professional, law enforcement appropriate language
- Format responses clearly with relevant file numbers and dates

IMPORTANT: Only use information from the DATABASE CONTEXT below. Do not make up information.

${context}

USER QUESTION: ${question}

Please provide a comprehensive answer based on the database records above. If the question cannot be answered with the available data, explain what information is missing.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    if (!response) {
      throw new Error("No response from AI model");
    }

    return response.text();
  } catch (error) {
    console.error("AI generation error:", error);
    throw new Error("Failed to generate AI response");
  }
}

/**
 * Main chat function that searches database and generates response
 */
export async function processChatMessage(
  question: string,
  searchLimit: number = 8
): Promise<{
  response: string;
  sources: Array<{ id: number; file_no: string; title: string }>;
  searchQuery: string;
}> {
  try {
    // Search the database for relevant records
    const records = await searchDatabase(question, searchLimit);

    if (records.length === 0) {
      return {
        response:
          "I couldn't find any relevant records in the database for your query. Please try rephrasing your question or using different keywords.",
        sources: [],
        searchQuery: question,
      };
    }

    // Prepare context for AI
    const context = prepareContextForAI(records);

    // Generate AI response
    const aiResponse = await generateAIResponse(question, context);

    // Prepare sources for reference
    const sources = records.map((record) => ({
      id: record.id,
      file_no: record.file_no,
      title: record.title,
    }));

    return {
      response: aiResponse,
      sources,
      searchQuery: question,
    };
  } catch (error) {
    console.error("Chat processing error:", error);
    throw new Error("Failed to process your question. Please try again.");
  }
}

/**
 * Get conversation context for follow-up questions
 */
export async function getConversationContext(
  previousMessages: ChatMessage[],
  currentQuestion: string
): Promise<string> {
  const relevantMessages = previousMessages
    .slice(-4) // Get last 4 messages for context
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");

  return `
CONVERSATION HISTORY:
${relevantMessages}

CURRENT QUESTION: ${currentQuestion}
`;
}
