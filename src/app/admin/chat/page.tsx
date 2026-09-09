"use client";

import React, { useState, useRef, useEffect } from "react";
import { MessageSquare, Bot, AlertCircle, Sparkles, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChatMessage, ChatSource } from "@/lib/ai/chat/types";
import { ChatMessageItem } from "@/components/chat/chat-message-item";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatSourcesDialog } from "@/components/chat/chat-sources-dialog";

export default function AdminChatPage() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputMessage, setInputMessage] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
	const [progressText, setProgressText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [provider] = useState<"gemini">("gemini");
	const [model, setModel] = useState<string>("gemini-2.5-flash");
	const [models, setModels] = useState<Array<{ name: string; label: string }>>([
		{ name: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fastest)" },
		{ name: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
		{ name: "gemini-flash-latest", label: "Gemini Flash (Latest)" },
		{ name: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
	]);

	// Dialog state for viewing sources
	const [selectedSource, setSelectedSource] = useState<ChatSource | null>(null);
	const [isSourcesDialogOpen, setIsSourcesDialogOpen] = useState(false);
	const [activeDialogSources, setActiveDialogSources] = useState<ChatSource[]>([]);

	const scrollAreaRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom as content streams
	const scrollToBottom = () => {
		if (scrollAreaRef.current) {
			scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
		}
	};

	useEffect(() => {
		scrollToBottom();
	}, [messages, progressText]);

	// Fetch models on mount
	useEffect(() => {
		let cancelled = false;
		async function fetchModels() {
			try {
				const res = await fetch(`/api/admin/ai/models?provider=${provider}`);
				if (!res.ok) return;
				const data = await res.json();
				if (cancelled) return;
				if (Array.isArray(data.models) && data.models.length > 0) {
					setModels(data.models);
					// Set primary model if not set or invalid
					if (!data.models.some((m: any) => m.name === model)) {
						setModel(data.models[0].name);
					}
				}
			} catch (err) {
				console.warn("[AdminChat] Failed to load models:", err);
			}
		}
		fetchModels();
		return () => {
			cancelled = true;
		};
	}, [provider]);

	const handleViewSource = (source: ChatSource, allSources: ChatSource[] = []) => {
		setSelectedSource(source);
		setActiveDialogSources(allSources.length > 0 ? allSources : [source]);
		setIsSourcesDialogOpen(true);
	};

	const clearChat = () => {
		if (isLoading) return;
		setMessages([]);
		setError(null);
		setProgressText(null);
	};

	const handleSendMessage = async () => {
		const trimmed = inputMessage.trim();
		if (!trimmed || isLoading) return;

		const userMessage: ChatMessage = {
			id: `user_${Date.now()}`,
			role: "user",
			content: trimmed,
			timestamp: new Date(),
		};

		const assistantMessageId = `asst_${Date.now()}`;
		const assistantPlaceholder: ChatMessage = {
			id: assistantMessageId,
			role: "assistant",
			content: "",
			timestamp: new Date(),
		};

		setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
		setInputMessage("");
		setIsLoading(true);
		setIsStreaming(true);
		setStreamingMessageId(assistantMessageId);
		setProgressText("Analyzing question...");
		setError(null);

		try {
			const response = await fetch("/api/admin/chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					message: trimmed,
					conversationHistory: messages,
					provider,
					model,
					stream: true,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				if (response.status === 429) {
					toast.error("You are making requests too quickly. Please wait a moment.");
					setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
					return;
				}
				throw new Error(errorData?.error || `HTTP error ${response.status}`);
			}

			const reader = response.body?.getReader();
			const decoder = new TextDecoder("utf-8");

			if (!reader) {
				throw new Error("Failed to initialize response stream reader.");
			}

			let accumulatedText = "";
			let streamSources: ChatSource[] = [];
			let streamTokenCount: any = null;
			let isFirstToken = true;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split("\n");

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const eventData = JSON.parse(line.substring(6));

							if (eventData.type === "progress") {
								setProgressText(eventData.progress || null);
							} else if (eventData.type === "token") {
								if (isFirstToken) {
									isFirstToken = false;
									setProgressText(null);
								}
								accumulatedText += eventData.text || "";
								setMessages((prev) =>
									prev.map((msg) =>
										msg.id === assistantMessageId
											? { ...msg, content: accumulatedText }
											: msg
									)
								);
							} else if (eventData.type === "sources") {
								streamSources = eventData.sources || [];
								setMessages((prev) =>
									prev.map((msg) =>
										msg.id === assistantMessageId
											? { ...msg, sources: streamSources }
											: msg
									)
								);
							} else if (eventData.type === "done") {
								streamTokenCount = eventData.tokenCount;
								setMessages((prev) =>
									prev.map((msg) =>
										msg.id === assistantMessageId
											? {
													...msg,
													content: accumulatedText || msg.content,
													tokenCount: streamTokenCount,
											  }
											: msg
									)
								);
								setProgressText(null);
							} else if (eventData.type === "error") {
								throw new Error(eventData.error || "Streaming error occurred.");
							}
						} catch (jsonErr) {
							// Non-JSON or incomplete line in stream chunk, continue
						}
					}
				}
			}
		} catch (err: any) {
			console.error("[AdminChat] Communication error:", err);
			const errorMsg = err?.message || "An unexpected error occurred while generating the response.";
			setError(errorMsg);
			setMessages((prev) =>
				prev.map((msg) =>
					msg.id === assistantMessageId
						? {
								...msg,
								content: `⚠️ I encountered an issue processing your request: ${errorMsg}. Please verify connection or try again.`,
						  }
						: msg
				)
			);
		} finally {
			setIsLoading(false);
			setIsStreaming(false);
			setStreamingMessageId(null);
			setProgressText(null);
		}
	};

	return (
		<div className="w-full h-[calc(100vh-64px)] p-3 md:p-6 flex flex-col gap-3">
			{error && (
				<Alert variant="destructive" className="shrink-0">
					<AlertCircle className="h-4 w-4" />
					<AlertDescription className="text-xs">{error}</AlertDescription>
				</Alert>
			)}

			<Card className="flex-1 flex flex-col min-h-0 shadow-sm border border-border overflow-hidden">
				{/* Card Header */}
				<CardHeader className="py-3 px-4 border-b border-border/70 flex-shrink-0 bg-muted/20">
					<div className="flex items-center justify-between gap-4 flex-wrap">
						<div className="flex items-center gap-3">
							<div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
								<Shield className="h-4 w-4" />
							</div>
							<div>
								<CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
									Smart Docs AI Intelligence
									<Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
										Fast Hybrid Stream
									</Badge>
								</CardTitle>
								<p className="text-xs text-muted-foreground">
									Search and query documents, categories, reports, and archive records.
								</p>
							</div>
						</div>

						{progressText && (
							<div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-900 animate-pulse">
								<Sparkles className="h-3.5 w-3.5" />
								<span>{progressText}</span>
							</div>
						)}
					</div>
				</CardHeader>

				{/* Chat Messages Scroll Container */}
				<CardContent className="flex-1 p-0 min-h-0 flex flex-col bg-background/50">
					<div
						ref={scrollAreaRef}
						className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scroll-smooth"
					>
						{messages.length === 0 ? (
							<div className="flex flex-col items-center justify-center h-full min-h-[300px] text-muted-foreground space-y-4 text-center px-4">
								<div className="h-14 w-14 rounded-2xl bg-muted/60 flex items-center justify-center text-primary/70 shadow-inner">
									<Bot className="h-7 w-7" />
								</div>
								<div className="space-y-1 max-w-md">
									<h3 className="font-semibold text-base text-foreground">
										How can I help with your documents?
									</h3>
									<p className="text-xs text-muted-foreground leading-relaxed">
										Ask direct questions about file numbers, topics, categories, specific records, or request summaries.
									</p>
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full pt-2">
									{[
										"Show recent documents in the archive",
										"Summarize records by category",
										"Search documents by keyword or topic",
										"List files sorted by date",
									].map((suggestion) => (
										<button
											key={suggestion}
											onClick={() => {
												setInputMessage(suggestion);
											}}
											className="p-2.5 rounded-lg border border-border bg-card hover:bg-muted text-xs text-left text-foreground/80 hover:text-foreground transition-all shadow-2xs"
										>
											💡 {suggestion}
										</button>
									))}
								</div>
							</div>
						) : (
							messages.map((message) => (
								<ChatMessageItem
									key={message.id}
									message={message}
									isStreaming={isStreaming && message.id === streamingMessageId}
									onViewSource={(src) => handleViewSource(src, message.sources)}
								/>
							))
						)}
					</div>

					{/* Chat Input Bar */}
					<ChatInput
						inputMessage={inputMessage}
						setInputMessage={setInputMessage}
						onSend={handleSendMessage}
						isLoading={isLoading}
						onClear={clearChat}
						model={model}
						setModel={setModel}
						models={models}
						hasMessages={messages.length > 0}
					/>
				</CardContent>
			</Card>

			{/* Source Inspection Modal */}
			<ChatSourcesDialog
				isOpen={isSourcesDialogOpen}
				onClose={() => {
					setIsSourcesDialogOpen(false);
					setSelectedSource(null);
				}}
				sources={activeDialogSources}
				selectedSource={selectedSource}
			/>
		</div>
	);
}
