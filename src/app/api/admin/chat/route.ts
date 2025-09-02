import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  processChatMessageEnhanced,
  ChatMessage,
} from "@/lib/ai-service-enhanced";
import { isAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin role
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userRole = (session.user as any).role;
    if (!isAdmin(userRole)) {
      return NextResponse.json(
        { error: "Admin privileges required" },
        { status: 403 }
      );
    }

    // Validate request body
    const body = await request.json();
    const { message, conversationHistory, provider, model, keyId } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required and must be a string" },
        { status: 400 }
      );
    }

    if (message.trim().length === 0) {
      return NextResponse.json(
        { error: "Message cannot be empty" },
        { status: 400 }
      );
    }

    if (message.length > 1000) {
      return NextResponse.json(
        { error: "Message is too long (max 1000 characters)" },
        { status: 400 }
      );
    }

    // Validate optional provider/model
    let opts: { provider?: "gemini"; model?: string; keyId?: number } = {};
    if (provider) {
      if (provider !== "gemini") {
        return NextResponse.json(
          { error: "Unsupported provider. Currently only 'gemini' is supported." },
          { status: 400 }
        );
      }
      opts.provider = provider;
    }
    if (model && typeof model === "string") {
      opts.model = model;
    }
    if (keyId !== undefined) {
      const parsed = Number(keyId);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json(
          { error: "keyId must be a number" },
          { status: 400 }
        );
      }
      opts.keyId = parsed;
    }

    // Process the chat message
    console.log(`[ADMIN CHAT] User ${session.user.email} asked: "${message}"`);

    const result = await processChatMessageEnhanced(
      message,
      conversationHistory || [],
      undefined,
      true,
      opts
    );

    // Create response message
    const responseMessage: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: "assistant",
      content: result.response,
      timestamp: new Date(),
      sources: result.sources,
      tokenCount: result.tokenCount, // Include token count information
    };

    // Log the interaction for audit purposes
    console.log(
      `[ADMIN CHAT] Response generated with ${result.sources.length} sources`
    );

    return NextResponse.json({
      success: true,
      message: responseMessage,
      sources: result.sources,
      searchQuery: result.searchQuery,
      searchMethod: result.searchMethod,
      queryType: result.queryType,
      analysisUsed: result.analysisUsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[ADMIN CHAT] Error processing chat message:", error);

    if (error.message === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        {
          success: false,
          error: "You are asking too fast, please try again after some time.",
          errorCode: "RATE_LIMIT_EXCEEDED",
        },
        { status: 429 }
      );
    }

    // Don't expose internal errors to the client
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return NextResponse.json(
      {
        success: false,
        error: "Failed to process your question. Please try again.",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

// GET endpoint for testing API availability
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userRole = (session.user as any).role;
    if (!isAdmin(userRole)) {
      return NextResponse.json(
        { error: "Admin privileges required" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "AI Chat API is available",
      user: session.user.email,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ADMIN CHAT] Error in GET endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: "API endpoint error",
      },
      { status: 500 }
    );
  }
}
