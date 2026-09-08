"use client";

import React from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, ExternalLink } from "lucide-react";
import Link from "next/link";
import { ChatSource } from "@/lib/ai/chat/types";

interface ChatSourcesDialogProps {
	isOpen: boolean;
	onClose: () => void;
	sources: ChatSource[];
	selectedSource?: ChatSource | null;
}

export function ChatSourcesDialog({
	isOpen,
	onClose,
	sources,
	selectedSource,
}: ChatSourcesDialogProps) {
	const displaySources = selectedSource ? [selectedSource] : sources;

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card text-card-foreground">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FileText className="h-5 w-5 text-primary" />
						{selectedSource ? "Source Document Details" : `Cited Sources (${sources.length})`}
					</DialogTitle>
					<DialogDescription>
						Referenced case records from the CID document database.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 mt-3">
					{displaySources.map((source) => (
						<div
							key={source.id}
							className="p-4 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors space-y-2"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="space-y-1">
									<div className="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" className="font-mono text-xs">
											{source.file_no}
										</Badge>
										{source.category && (
											<Badge variant="secondary" className="text-xs">
												{source.category}
											</Badge>
										)}
										{source.relevance !== undefined && (
											<Badge variant="outline" className="text-[10px] text-muted-foreground">
												Relevance: {(source.relevance * 100).toFixed(0)}%
											</Badge>
										)}
									</div>
									<h4 className="font-semibold text-sm leading-tight text-foreground">
										{source.title}
									</h4>
								</div>
								<Link
									href={`/admin/files/${source.id}`}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
								>
									View File
									<ExternalLink className="h-3 w-3" />
								</Link>
							</div>
						</div>
					))}

					{displaySources.length === 0 && (
						<p className="text-sm text-muted-foreground text-center py-6">
							No sources available for this message.
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
