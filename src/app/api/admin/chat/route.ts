import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  processChat,
  processChatMessage,
} from "@/lib/ai/chat/process-chat";
import type { ChatMessage } from "@/lib/ai/chat/types";
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
    const { message, conversationHistory, provider, model, keyId, stream = true } = body;

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

    if (message.length > 2000) {
      return NextResponse.json(
        { error: "Message is too long (max 2000 characters)" },
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

    console.log(`[ADMIN CHAT] User ${session.user.email} asked: "${message.substring(0, 80)}" (stream=${stream})`);

    // Handle streaming response via Server-Sent Events (SSE)
    if (stream) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of processChat(
              message,
              conversationHistory || [],
              opts
            )) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
              );
            }
            controller.close();
          } catch (streamError: any) {
            console.error("[ADMIN CHAT STREAM ERROR]", streamError);
            const errPayload = JSON.stringify({
              type: "error",
              error: "Failed to process question. Please try again.",
            });
            controller.enqueue(encoder.encode(`data: ${errPayload}\n\n`));
            controller.close();
          }
        },
      });

      return new NextResponse(customReadable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming fallback
    const result = await processChatMessage(
      message,
      conversationHistory || [],
      opts
    );

    const responseMessage: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: "assistant",
      content: result.response,
      timestamp: new Date(),
      sources: result.sources,
      tokenCount: result.tokenCount,
    };

    return NextResponse.json({
      success: true,
      message: responseMessage,
      sources: result.sources,
      searchQuery: result.searchQuery,
      searchMethod: result.searchMethod,
      queryType: result.queryType,
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
