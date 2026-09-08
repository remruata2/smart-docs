"use client";

import React, { useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
	inputMessage: string;
	setInputMessage: (val: string) => void;
	onSend: () => void;
	isLoading: boolean;
	onClear?: () => void;
	model: string;
	setModel: (m: string) => void;
	models: Array<{ name: string; label: string }>;
	hasMessages: boolean;
}

export function ChatInput({
	inputMessage,
	setInputMessage,
	onSend,
	isLoading,
	onClear,
	model,
	setModel,
	models,
	hasMessages,
}: ChatInputProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Auto-resize textarea as user types
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
		}
	}, [inputMessage]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (!isLoading && inputMessage.trim()) {
				onSend();
			}
		}
	};

	return (
		<div className="border-t border-border bg-card/80 backdrop-blur px-4 py-3 space-y-2">
			<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<Sparkles className="h-3.5 w-3.5 text-blue-500" />
					<span className="font-medium">Model:</span>
					<select
						value={model}
						onChange={(e) => setModel(e.target.value)}
						disabled={isLoading}
						className="bg-background border border-border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer disabled:opacity-50"
					>
						{models.map((m) => (
							<option key={m.name} value={m.name}>
								{m.label}
							</option>
						))}
					</select>
				</div>

				{hasMessages && onClear && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onClear}
						disabled={isLoading}
						className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
					>
						<Trash2 className="h-3 w-3 mr-1" />
						Clear conversation
					</Button>
				)}
			</div>

			<div className="relative flex items-end gap-2 bg-background border border-border rounded-xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
				<textarea
					ref={textareaRef}
					value={inputMessage}
					onChange={(e) => setInputMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask about cases, file numbers, crime categories, suspects, or dates... (Enter to send, Shift+Enter for new line)"
					disabled={isLoading}
					rows={1}
					className="flex-1 bg-transparent resize-none border-0 p-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[38px] max-h-[160px] leading-relaxed"
				/>

				<Button
					onClick={onSend}
					disabled={isLoading || !inputMessage.trim()}
					size="icon"
					className="h-9 w-9 rounded-lg shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-40"
				>
					{isLoading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Send className="h-4 w-4" />
					)}
				</Button>
			</div>
			<div className="text-[11px] text-center text-muted-foreground">
				CID AI search utilizes hybrid tsvector + semantic embeddings with real-time streaming.
			</div>
		</div>
	);
}
