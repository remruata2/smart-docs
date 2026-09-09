"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User, Copy, Check, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatMessage, ChatSource } from "@/lib/ai/chat/types";

interface ChatMessageItemProps {
	message: ChatMessage;
	onViewSource?: (source: ChatSource) => void;
	isStreaming?: boolean;
}

export function ChatMessageItem({
	message,
	onViewSource,
	isStreaming = false,
}: ChatMessageItemProps) {
	const isUser = message.role === "user";
	const [copied, setCopied] = useState(false);
	const [showAllSources, setShowAllSources] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy text:", err);
		}
	};

	const sources = message.sources || [];
	const visibleSources = showAllSources ? sources : sources.slice(0, 4);

	return (
		<div
			className={`flex gap-3 p-4 rounded-xl transition-colors ${
				isUser
					? "bg-primary/5 ml-auto max-w-[85%] border border-primary/10"
					: "bg-muted/40 mr-auto max-w-[90%] border border-border/50"
			}`}
		>
			<div className="shrink-0 mt-0.5">
				{isUser ? (
					<div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
						<User className="h-4 w-4" />
					</div>
				) : (
					<div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm">
						<Bot className="h-4 w-4" />
					</div>
				)}
			</div>

			<div className="flex-1 min-w-0 space-y-2">
				<div className="flex items-center justify-between gap-2">
					<span className="font-semibold text-xs tracking-tight text-foreground/80">
						{isUser ? "You" : "Smart Docs Assistant"}
					</span>
					<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						{message.tokenCount && (
							<span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
								{message.tokenCount.output} tokens
							</span>
						)}
						<span>
							{message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground hover:text-foreground"
							onClick={handleCopy}
							title="Copy message"
						>
							{copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
						</Button>
					</div>
				</div>

				{/* Message Body */}
				<div className="prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed break-words">
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={{
							table: ({ children }) => (
								<div className="overflow-x-auto my-3 border rounded-lg">
									<table className="min-w-full divide-y divide-border text-xs">
										{children}
									</table>
								</div>
							),
							th: ({ children }) => (
								<th className="px-3 py-2 bg-muted/60 font-semibold text-left text-foreground">
									{children}
								</th>
							),
							td: ({ children }) => (
								<td className="px-3 py-2 border-t border-border/50 text-foreground/90">
									{children}
								</td>
							),
							p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
							ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
							ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
							li: ({ children }) => <li className="pl-0.5">{children}</li>,
							code: ({ children }) => (
								<code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs text-foreground">
									{children}
								</code>
							),
						}}
					>
						{message.content}
					</ReactMarkdown>

					{isStreaming && (
						<span className="inline-block w-1.5 h-4 ml-1 bg-primary animate-pulse align-middle" />
					)}
				</div>

				{/* Sources Badges */}
				{sources.length > 0 && (
					<div className="pt-2 border-t border-border/40 mt-3 space-y-1.5">
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							<span className="flex items-center gap-1 font-medium text-[11px]">
								<FileText className="h-3 w-3 text-primary" />
								Referenced Sources ({sources.length}):
							</span>
							{sources.length > 4 && (
								<Button
									variant="ghost"
									size="sm"
									className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
									onClick={() => setShowAllSources(!showAllSources)}
								>
									{showAllSources ? (
										<span className="flex items-center gap-0.5">
											Show less <ChevronUp className="h-3 w-3" />
										</span>
									) : (
										<span className="flex items-center gap-0.5">
											+{sources.length - 4} more <ChevronDown className="h-3 w-3" />
										</span>
									)}
								</Button>
							)}
						</div>

						<div className="flex flex-wrap gap-1.5">
							{visibleSources.map((source) => (
								<button
									key={source.id}
									onClick={() => onViewSource && onViewSource(source)}
									className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background hover:bg-muted border border-border text-xs text-foreground/80 hover:text-foreground transition-colors text-left"
									title={source.title}
								>
									<span className="font-mono text-[11px] font-medium text-primary">
										{source.file_no}
									</span>
									<span className="truncate max-w-[150px] text-[11px] text-muted-foreground group-hover:text-foreground">
										{source.title}
									</span>
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
