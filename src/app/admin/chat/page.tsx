"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Send,
  Bot,
  User,
  FileText,
  AlertCircle,
  MessageSquare,
  ExternalLink,
  Copy,
  Check,
  FileDown,
} from "lucide-react";
// PDF generation removed - using text export instead
import { toast } from "sonner";
import { ChatMessage } from "@/lib/ai-service";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatSource {
  id: number;
  file_no: string;
  title: string;
}

interface ChatResponse {
  success: boolean;
  message: ChatMessage;
  sources: ChatSource[];
  searchQuery: string;
  queryType?: string;
  analysisUsed?: boolean;
  error?: string;
}

export default function AdminChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"gemini">("gemini");
  const [model, setModel] = useState<string>("gemini-2.5-pro");
  const [models, setModels] = useState<Array<{ name: string; label: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [lastResponseMeta, setLastResponseMeta] = useState<{
    queryType?: string;
    searchQuery?: string;
    analysisUsed?: boolean;
  } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // Track expanded source lists by message ID
  const [expandedSources, setExpandedSources] = useState<
    Record<string, boolean>
  >({});

  // Load available models for current provider
  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      try {
        setModelsLoading(true);
        const res = await fetch(`/api/admin/ai/models?provider=${provider}`);
        if (!res.ok) throw new Error("Failed to load models");
        const data = await res.json();
        if (cancelled) return;
        const list: Array<{ name: string; label: string }> = Array.isArray(data.models)
          ? data.models
          : [];
        setModels(list);
        // If current model not in list, set to first available
        if (list.length > 0 && !list.some((m) => m.name === model)) {
          setModel(list[0].name);
        }
      } catch (e) {
        console.error("[AdminChat] Failed to fetch models", e);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }
    loadModels();
    return () => {
      cancelled = true;
    };
  }, [provider]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initial number of sources to show
  const INITIAL_SOURCES_SHOWN = 15;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    // Add user message to chat
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage.content,
          conversationHistory: messages,
          provider,
          model,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const errorData = await response.json();
          if (response.status === 429) {
            toast.error(
              errorData.error ||
                "You are making requests too quickly. Please wait and try again."
            );
            // We return here so we don't also add an error to the chat
            return;
          }
          throw new Error(errorData.error || "An unknown error occurred");
        } else {
          const errorText = await response.text();
          console.error("Received non-JSON error response:", errorText);
          
          // Show toast for non-JSON errors (like 504 Gateway Timeout)
          let errorMessage = "The server returned an unexpected response";
          if (errorText.includes("504 Gateway Time-out")) {
            errorMessage = "Server timeout. Please try again later.";
          } else if (errorText.includes("502 Bad Gateway")) {
            errorMessage = "Server error. Please try again later.";
          } else if (errorText.includes("500 Internal Server Error")) {
            errorMessage = "Internal server error. Please try again later.";
          }
          
          toast.error(errorMessage);
          throw new Error(
            "The server returned an unexpected response. Check the console for details."
          );
        }
      }

      const data: ChatResponse = await response.json();

      if (data.success && data.message) {
        setMessages((prev) => [...prev, data.message]);
        setLastResponseMeta({
          queryType: data.queryType,
          searchQuery: data.searchQuery,
          analysisUsed: data.analysisUsed,
        });
      } else {
        throw new Error(data.error || "Invalid response format");
      }
    } catch (error: unknown) {
      console.error("Chat error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      setError(errorMessage);

      let displayMessage = `I apologize, but I encountered an error: ${errorMessage}. Please try again.`;

      if (error instanceof Error && error.message.includes("The server returned an unexpected response")) {
        displayMessage = "I apologize, but the server returned an unexpected response. Please try again later.";
      }

      const errorChatMessage: ChatMessage = {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: displayMessage,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorChatMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setExpandedSources({});
  };

  // Toggle source expansion for a specific message
  const toggleSourceExpansion = (messageId: string) => {
    setExpandedSources((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const formatTimestamp = (timestamp: Date | string | undefined) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Truncate source title for display
  const truncateTitle = (title: string, maxLength: number = 40) => {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength).trim() + "...";
  };

  // Copy message content to clipboard
  const handleCopy = async (text: string, messageId: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  // Types for formatted content
  interface FormattedLine {
    text: string;
    type:
      | "header1"
      | "header2"
      | "header3"
      | "paragraph"
      | "bullet"
      | "numbered"
      | "code"
      | "empty"
      | "table_header"
      | "table_row"
      | "table_separator";
    size: number;
    font: "regular" | "bold" | "italic" | "mono";
    spacing: number;
    indent: number;
    isBold?: boolean;
    isItalic?: boolean;
    bulletId?: string; // Add unique identifier for bullet groups
    isWrappedLine?: boolean; // Track if this is a wrapped continuation
    isJustified?: boolean; // Track if this line should be justified
    justificationData?: { words: string[]; spacing: number }; // Justification spacing data
    tableId?: string; // Unique identifier for table groups
    tableCells?: string[]; // Array of cell contents for table rows
    isTableHeader?: boolean; // Whether this is a table header row
  }

  // Parse inline formatting (bold, italic) from a line of text
  const parseInlineFormatting = (
    text: string
  ): Array<{ text: string; isBold: boolean; isItalic: boolean }> => {
    const segments: Array<{
      text: string;
      isBold: boolean;
      isItalic: boolean;
    }> = [];

    // Clean up the text first
    let cleanText = text
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove inline code formatting
      .replace(/`([^`]+)`/g, "$1");

    // Split by bold markers first
    const boldParts = cleanText.split(/(\*\*[^*]+\*\*)/);

    for (const boldPart of boldParts) {
      if (boldPart.match(/^\*\*.*\*\*$/)) {
        // This is bold text
        const boldText = boldPart.replace(/^\*\*/, "").replace(/\*\*$/, "");
        segments.push({
          text: boldText,
          isBold: true,
          isItalic: false,
        });
      } else {
        // Check for italic text in non-bold parts
        const italicParts = boldPart.split(/(\*[^*]+\*)/);

        for (const italicPart of italicParts) {
          if (
            italicPart.match(/^\*.*\*$/) &&
            !italicPart.match(/^\*\*.*\*\*$/)
          ) {
            // This is italic text (but not bold)
            const italicText = italicPart.replace(/^\*/, "").replace(/\*$/, "");
            segments.push({
              text: italicText,
              isBold: false,
              isItalic: true,
            });
          } else if (italicPart.trim()) {
            // Regular text
            segments.push({
              text: italicPart,
              isBold: false,
              isItalic: false,
            });
          }
        }
      }
    }

    // Filter out empty segments and return
    return segments.filter((seg) => seg.text.trim().length > 0);
  };

  // Parse markdown and create formatted lines
  const parseMarkdownToFormattedLines = (text: string): FormattedLine[] => {
    const lines = text.split("\n");
    const formattedLines: FormattedLine[] = [];
    let listNumber = 1;
    let bulletCounter = 0; // Counter for unique bullet IDs
    let tableCounter = 0; // Counter for unique table IDs

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === "") {
        formattedLines.push({
          text: "",
          type: "empty",
          size: 12,
          font: "regular",
          spacing: 8,
          indent: 0,
        });
        continue;
      }

      // Headers
      if (line.match(/^#{1}\s+/)) {
        formattedLines.push({
          text: line.replace(/^#{1}\s+/, ""),
          type: "header1",
          size: 18,
          font: "bold",
          spacing: 25,
          indent: 0,
        });
      } else if (line.match(/^#{2}\s+/)) {
        formattedLines.push({
          text: line.replace(/^#{2}\s+/, ""),
          type: "header2",
          size: 16,
          font: "bold",
          spacing: 22,
          indent: 0,
        });
      } else if (line.match(/^#{3,6}\s+/)) {
        formattedLines.push({
          text: line.replace(/^#{3,6}\s+/, ""),
          type: "header3",
          size: 14,
          font: "bold",
          spacing: 20,
          indent: 0,
        });
      }
      // Bullet points (including • character)
      else if (line.match(/^[\s]*[•\-*+]\s+/) || line.match(/^[\s]*•/)) {
        // Detect indentation level for nested bullets
        const leadingSpaces = line.match(/^(\s*)/)?.[1]?.length || 0;
        const indentLevel = Math.floor(leadingSpaces / 2); // Every 2 spaces = 1 indent level
        const baseIndent = 20;
        const nestedIndent = baseIndent + indentLevel * 15; // 15 points per level

        // Extract the full bullet line content
        let bulletContent = line.trim();

        // Ensure it starts with bullet point
        if (!bulletContent.startsWith("•")) {
          bulletContent = bulletContent.replace(/^[\s]*[\-*+]\s*/, "• ");
        }

        // Assign unique ID to this bullet point
        const currentBulletId = `bullet_${bulletCounter++}`;

        // Parse the entire bullet line to preserve mixed formatting
        const segments = parseInlineFormatting(bulletContent);

        // Keep segments separate for mixed formatting, but mark them all as bullet type with same ID
        for (let segIndex = 0; segIndex < segments.length; segIndex++) {
          const segment = segments[segIndex];
          formattedLines.push({
            text: segment.text,
            type: "bullet",
            size: 12,
            font: segment.isBold
              ? "bold"
              : segment.isItalic
              ? "italic"
              : "regular",
            spacing: 18, // Increased spacing for better readability
            indent: segIndex === 0 ? nestedIndent : nestedIndent + 12, // First segment at bullet level, rest aligned with text
            isBold: segment.isBold,
            isItalic: segment.isItalic,
            bulletId: currentBulletId,
          });
        }
      }
      // Numbered lists
      else if (line.match(/^[\s]*\d+\.\s+/)) {
        formattedLines.push({
          text: `${listNumber}. ` + line.replace(/^[\s]*\d+\.\s+/, ""),
          type: "numbered",
          size: 12,
          font: "regular",
          spacing: 16,
          indent: 20,
        });
        listNumber++;
      }
      // Code blocks (simplified)
      else if (line.match(/^```/) || line.match(/^\s{4,}/)) {
        formattedLines.push({
          text: line.replace(/^```\w*\s*/, "").replace(/^```\s*$/, ""),
          type: "code",
          size: 10,
          font: "mono",
          spacing: 14,
          indent: 20,
        });
      }
      // Table detection (markdown tables with | separators OR HTML tables)
      else if (
        (line.includes("|") &&
          line.trim().startsWith("|") &&
          line.trim().endsWith("|")) ||
        line.trim().match(/^<tr[^>]*>.*<\/tr>$/i) ||
        line.trim().match(/^<th[^>]*>.*<\/th>$/i) ||
        line.trim().match(/^<td[^>]*>.*<\/td>$/i)
      ) {
        // Check if next line is a separator line (contains dashes and pipes)
        const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
        const isSeparatorNext = nextLine.match(/^\|[\s\-:|]+\|$/);

        // Determine table ID - use current counter for new tables (headers), use current counter for data rows
        const currentTableId = isSeparatorNext
          ? `table_${tableCounter}`
          : `table_${tableCounter - 1}`;

        // Parse table cells
        const cells = line
          .split("|")
          .slice(1, -1) // Remove empty first and last elements
          .map((cell) => cell.trim());

        if (isSeparatorNext) {
          // This is a header row
          formattedLines.push({
            text: line,
            type: "table_header",
            size: 11,
            font: "bold",
            spacing: 16,
            indent: 0,
            tableId: currentTableId,
            tableCells: cells,
            isTableHeader: true,
          });

          // Skip the separator line
          i++;
          formattedLines.push({
            text: nextLine,
            type: "table_separator",
            size: 11,
            font: "regular",
            spacing: 2,
            indent: 0,
            tableId: currentTableId,
            tableCells: [],
          });

          // Increment table counter AFTER processing header
          tableCounter++;
        } else {
          // This is a regular table row - use the previous table ID to match the header
          formattedLines.push({
            text: line,
            type: "table_row",
            size: 11,
            font: "regular",
            spacing: 14,
            indent: 0,
            tableId: currentTableId,
            tableCells: cells,
            isTableHeader: false,
          });
        }
      }
      // Regular paragraphs
      else {
        // Process the line to handle mixed inline formatting
        const segments = parseInlineFormatting(line);

        // For paragraphs, we need to keep segments separate to maintain mixed formatting
        for (const segment of segments) {
          formattedLines.push({
            text: segment.text,
            type: "paragraph",
            size: 12,
            font: segment.isBold
              ? "bold"
              : segment.isItalic
              ? "italic"
              : "regular",
            spacing: 18, // Increased spacing for better readability
            indent: 0,
            isBold: segment.isBold,
            isItalic: segment.isItalic,
          });
        }
      }
    }

    return formattedLines;
  };

  // Helper function to justify text by calculating word spacing
  const justifyText = (
    text: string,
    targetWidth: number,
    font: any,
    fontSize: number
  ): { words: string[]; spacing: number } => {
    const words = text.split(" ");
    if (words.length <= 1) {
      return { words, spacing: 0 };
    }

    // Calculate natural width without extra spacing
    const naturalWidth = font.widthOfTextAtSize(text, fontSize);
    const extraSpace = targetWidth - naturalWidth;
    const gaps = words.length - 1;

    // Calculate additional spacing per gap
    const additionalSpacing = gaps > 0 ? extraSpace / gaps : 0;

    return { words, spacing: additionalSpacing };
  };

  // Helper function to wrap individual text segments
  const wrapTextSegment = (
    segment: FormattedLine,
    maxWidth: number,
    regularFont: any,
    boldFont: any,
    italicFont: any,
    monoFont: any
  ): FormattedLine[] => {
    // Select appropriate font for measuring
    let measureFont = regularFont;
    if (segment.font === "bold") measureFont = boldFont;
    else if (segment.font === "italic") measureFont = italicFont;
    else if (segment.font === "mono") measureFont = monoFont;

    const words = segment.text.split(" ");
    let currentLine = "";
    const availableWidth = maxWidth - segment.indent;
    const wrappedSegments: FormattedLine[] = [];

    for (const word of words) {
      const testLine = currentLine + (currentLine ? " " : "") + word;

      let textWidth;
      try {
        textWidth = measureFont.widthOfTextAtSize(testLine, segment.size);
      } catch (encodingError) {
        console.warn("Text encoding issue with:", testLine);
        textWidth = testLine.length * segment.size * 0.6;
      }

      if (textWidth > availableWidth && currentLine) {
        // Add current line with justification (not for last line)
        const isWrapped = wrappedSegments.length > 0;
        const lineIndent =
          isWrapped && segment.type === "bullet"
            ? segment.indent + 12
            : segment.indent;

        // Calculate justification for this line
        const justificationData = justifyText(
          currentLine,
          availableWidth,
          measureFont,
          segment.size
        );

        wrappedSegments.push({
          ...segment,
          text: currentLine,
          isWrappedLine: isWrapped,
          indent: lineIndent,
          isJustified: true, // This line should be justified
          justificationData,
        });
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      const isWrapped = wrappedSegments.length > 0;
      wrappedSegments.push({
        ...segment,
        text: currentLine,
        isWrappedLine: isWrapped,
        // For wrapped bullet lines, increase indent to align with text
        indent:
          isWrapped && segment.type === "bullet"
            ? segment.indent + 12
            : segment.indent,
        // Don't justify the last line of each segment
        isJustified: false,
      });
    }

    return wrappedSegments;
  };

  // Helper function to wrap bullet segments together
  const wrapBulletSegments = (
    segments: FormattedLine[],
    maxWidth: number,
    regularFont: any,
    boldFont: any,
    italicFont: any,
    monoFont: any
  ): FormattedLine[] => {
    // Simpler approach: just wrap each segment individually and maintain bulletId
    const wrappedLines: FormattedLine[] = [];

    for (const segment of segments) {
      const wrappedSegments = wrapTextSegment(
        segment,
        maxWidth,
        regularFont,
        boldFont,
        italicFont,
        monoFont
      );
      wrappedLines.push(...wrappedSegments);
    }

    return wrappedLines;
  };

  // Helper function to render table
  const renderTable = (
    tableRows: FormattedLine[],
    page: any,
    yPosition: number,
    maxWidth: number,
    margin: number,
    regularFont: any,
    boldFont: any
  ): number => {
    console.log("=== renderTable DEBUG ===");
    console.log("Total rows received:", tableRows.length);
    console.log(
      "Row types:",
      tableRows.map((r) => r.type)
    );
    console.log(
      "Row table IDs:",
      tableRows.map((r) => r.tableId)
    );
    console.log("========================");

    if (tableRows.length === 0) return yPosition;

    // Calculate column widths based on content
    const headerRow = tableRows.find((row) => row.type === "table_header");
    if (!headerRow || !headerRow.tableCells) {
      console.log("No header row found!");
      return yPosition;
    }

    const numColumns = headerRow.tableCells.length;
    const columnWidth = (maxWidth - 40) / numColumns; // Leave some margin for borders
    const cellPadding = 4;
    const rowHeight = 16;

    let currentY = yPosition;
    const startY = yPosition; // Keep track of starting Y position for borders

    // Draw table border (top)
    page.drawLine({
      start: { x: margin, y: currentY },
      end: { x: margin + maxWidth - 40, y: currentY },
      thickness: 1,
      color: [0.5, 0.5, 0.5],
    });

    for (const row of tableRows) {
      if (row.type === "table_separator") continue; // Skip separator rows

      if (!row.tableCells) continue;

      currentY -= rowHeight;

      // Draw row background for header
      if (row.type === "table_header") {
        page.drawRectangle({
          x: margin,
          y: currentY - cellPadding,
          width: maxWidth - 40,
          height: rowHeight,
          color: [0.95, 0.95, 0.95],
        });
      }

      // Draw cell contents
      for (let i = 0; i < row.tableCells.length && i < numColumns; i++) {
        const cellContent = row.tableCells[i];
        const cellX = margin + i * columnWidth + cellPadding;

        // Truncate text if it's too long for the cell
        let displayText = cellContent;
        const maxCellWidth = columnWidth - cellPadding * 2;

        try {
          const font = row.type === "table_header" ? boldFont : regularFont;
          let textWidth = font.widthOfTextAtSize(displayText, row.size);

          // Truncate if needed
          while (textWidth > maxCellWidth && displayText.length > 3) {
            displayText = displayText.substring(0, displayText.length - 1);
            textWidth = font.widthOfTextAtSize(displayText + "...", row.size);
          }

          if (displayText !== cellContent) {
            displayText += "...";
          }
        } catch (encodingError) {
          // Fallback truncation
          const maxChars = Math.floor(maxCellWidth / (row.size * 0.6));
          if (displayText.length > maxChars) {
            displayText = displayText.substring(0, maxChars - 3) + "...";
          }
        }

        // Draw cell text
        page.drawText(displayText, {
          x: cellX,
          y: currentY,
          size: row.size,
          font: row.type === "table_header" ? boldFont : regularFont,
          color: [0, 0, 0],
        });
      }

      // Draw horizontal row border after each row
      page.drawLine({
        start: { x: margin, y: currentY - cellPadding },
        end: { x: margin + maxWidth - 40, y: currentY - cellPadding },
        thickness: row.type === "table_header" ? 1 : 0.5,
        color: [0.5, 0.5, 0.5],
      });
    }

    // Draw vertical borders for the entire table after all rows are processed
    const endY = currentY - cellPadding;
    for (let i = 0; i <= numColumns; i++) {
      page.drawLine({
        start: { x: margin + i * columnWidth, y: startY },
        end: { x: margin + i * columnWidth, y: endY },
        thickness: 0.5,
        color: [0.7, 0.7, 0.7],
      });
    }

    return currentY - cellPadding - 10; // Return new Y position with some spacing
  };

  // Export content as PDF with markdown support
  const handleExportText = async (text: string, sources?: ChatSource[]) => {
    if (!text) return;

    try {
      // Dynamic imports to avoid SSR issues
      const jsPDF = (await import('jspdf')).default;
      const { marked } = await import('marked');
      
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const maxWidth = pageWidth - 2 * margin;
      let currentY = margin;

      // Helper function to check if we need a new page
      const checkNewPage = (requiredHeight: number = 10) => {
        if (currentY + requiredHeight > pageHeight - margin) {
          doc.addPage();
          currentY = margin;
        }
      };

      // Helper function to render text with formatting
      const renderFormattedText = (content: string, fontSize: number = 12, isBold: boolean = false, isItalic: boolean = false) => {
        doc.setFontSize(fontSize);
        
        // Set font style
        if (isBold && isItalic) {
          doc.setFont('helvetica', 'bolditalic');
        } else if (isBold) {
          doc.setFont('helvetica', 'bold');
        } else if (isItalic) {
          doc.setFont('helvetica', 'italic');
        } else {
          doc.setFont('helvetica', 'normal');
        }

        const lines = doc.splitTextToSize(content, maxWidth);
        for (const line of lines) {
          checkNewPage();
          doc.text(line, margin, currentY);
          currentY += fontSize * 0.6; // Line height based on font size
        }
      };

      // Parse markdown and render content
      const parseAndRenderMarkdown = (markdownText: string) => {
        // Split content by lines to handle different markdown elements
        const lines = markdownText.split('\n');
        let inCodeBlock = false;
        let listLevel = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Handle code blocks
          if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            if (!inCodeBlock) currentY += 5; // Add spacing after code block
            continue;
          }

          if (inCodeBlock) {
            // Render code with monospace-like formatting
            doc.setFont('courier', 'normal');
            doc.setFontSize(10);
            checkNewPage();
            doc.text(line, margin + 10, currentY);
            currentY += 12;
            continue;
          }

          // Handle headers
          if (line.startsWith('# ')) {
            currentY += 10;
            renderFormattedText(line.substring(2), 18, true);
            currentY += 5;
            continue;
          }
          if (line.startsWith('## ')) {
            currentY += 8;
            renderFormattedText(line.substring(3), 16, true);
            currentY += 4;
            continue;
          }
          if (line.startsWith('### ')) {
            currentY += 6;
            renderFormattedText(line.substring(4), 14, true);
            currentY += 3;
            continue;
          }

          // Handle bullet points
          if (line.match(/^[\s]*[-*+]\s/)) {
            const indent = (line.match(/^(\s*)/)?.[1]?.length || 0) * 2;
            const content = line.replace(/^[\s]*[-*+]\s/, '');
            checkNewPage();
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(12);
            doc.text('•', margin + indent, currentY);
            
            // Handle inline formatting in bullet points
            renderInlineFormatting(content, margin + indent + 10);
            continue;
          }

          // Handle numbered lists
          if (line.match(/^[\s]*\d+\.\s/)) {
            const indent = (line.match(/^(\s*)/)?.[1]?.length || 0) * 2;
            const match = line.match(/^[\s]*(\d+)\.\s(.*)$/);
            if (match) {
              const number = match[1];
              const content = match[2];
              checkNewPage();
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(12);
              doc.text(`${number}.`, margin + indent, currentY);
              
              renderInlineFormatting(content, margin + indent + 15);
              continue;
            }
          }

          // Handle empty lines
          if (line.trim() === '') {
            currentY += 6;
            continue;
          }

          // Handle regular paragraphs with inline formatting
          renderInlineFormatting(line);
        }
      };

      // Helper function to render text with inline markdown formatting
      const renderInlineFormatting = (text: string, startX: number = margin) => {
        if (!text.trim()) return;

        // Simple regex patterns for inline formatting
        const boldPattern = /\*\*(.*?)\*\*/g;
        const italicPattern = /\*(.*?)\*/g;
        const codePattern = /`(.*?)`/g;

        let currentText = text;
        let segments: Array<{text: string, bold: boolean, italic: boolean, code: boolean}> = [];

        // Parse the text into segments with formatting
        let lastIndex = 0;
        let match;

        // Handle bold text
        while ((match = boldPattern.exec(text)) !== null) {
          if (match.index > lastIndex) {
            segments.push({
              text: text.substring(lastIndex, match.index),
              bold: false,
              italic: false,
              code: false
            });
          }
          segments.push({
            text: match[1],
            bold: true,
            italic: false,
            code: false
          });
          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
          segments.push({
            text: text.substring(lastIndex),
            bold: false,
            italic: false,
            code: false
          });
        }

        // If no bold formatting found, treat as single segment
        if (segments.length === 0) {
          segments = [{text: text, bold: false, italic: false, code: false}];
        }

        // Render each segment
        let currentX = startX;
        checkNewPage();
        
        for (const segment of segments) {
          if (!segment.text) continue;
          
          // Set font based on formatting
          if (segment.bold) {
            doc.setFont('helvetica', 'bold');
          } else if (segment.code) {
            doc.setFont('courier', 'normal');
          } else {
            doc.setFont('helvetica', 'normal');
          }
          
          doc.setFontSize(12);
          
          // Handle text wrapping
          const lines = doc.splitTextToSize(segment.text, maxWidth - (currentX - margin));
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              currentY += 7;
              checkNewPage();
              currentX = margin;
            }
            doc.text(lines[i], currentX, currentY);
            if (i === lines.length - 1) {
              currentX += doc.getTextWidth(lines[i]);
            }
          }
        }
        currentY += 7;
      };

      // Add title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('AI Response', margin, currentY);
      currentY += 15;

      // Add timestamp
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, currentY);
      currentY += 20;

      // Parse and render main content
      parseAndRenderMarkdown(text);

      // Add sources if available
      if (sources && sources.length > 0) {
        currentY += 15;
        checkNewPage(30);
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Sources:', margin, currentY);
        currentY += 15;
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        sources.forEach((source, index) => {
          checkNewPage();
          const sourceText = `${index + 1}. ${source.file_no}: ${source.title}`;
          const sourceLines = doc.splitTextToSize(sourceText, maxWidth);
          
          for (const line of sourceLines) {
            checkNewPage();
            doc.text(line, margin, currentY);
            currentY += 7;
          }
          currentY += 3;
        });
      }

      // Generate filename and download
      const filename = `cid-ai-response-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-")}.pdf`;
      
      doc.save(filename);
    } catch (err) {
      console.error("Failed to export PDF:", err);
      alert("Failed to export PDF. Please try again.");
    }
  };

  return (
    <div className="w-full h-full p-2">

      {error && (
        <Alert className="mb-4" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="h-[calc(100vh-24px)] flex flex-col">
        <CardHeader className="flex flex-col space-y-3 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Chat History
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="provider" className="text-sm text-gray-600">
                    Provider
                  </label>
                  <select
                    id="provider"
                    className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as "gemini")}
                  >
                    <option value="gemini">Gemini</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="model" className="text-sm text-gray-600">
                    Model
                  </label>
                  <select
                    id="model"
                    className="h-9 w-56 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={modelsLoading || models.length === 0}
                  >
                    {modelsLoading && (
                      <option>Loading models...</option>
                    )}
                    {!modelsLoading && models.length === 0 && (
                      <option>No models configured</option>
                    )}
                    {!modelsLoading &&
                      models.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.label || m.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearChat}>
                  Clear Chat
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 min-h-0">
          <div
            className="flex-1 overflow-y-auto p-4 scroll-smooth"
            ref={scrollAreaRef}
            style={{ scrollBehavior: "smooth" }}
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                <Bot className="h-12 w-12" />
                <div className="text-center">
                  <p className="text-lg font-medium">
                    Welcome to AI Assistant
                  </p>
                  <p className="text-sm">
                    Ask me anything about the database records
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                 
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`flex gap-3 max-w-[90%] ${
                        message.role === "user"
                          ? "flex-row-reverse"
                          : "flex-row"
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full ${
                          message.role === "user"
                            ? "bg-blue-500 text-white"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {message.role === "user" ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div
                        className={`rounded-lg px-4 py-2 break-words ${
                          message.role === "user"
                            ? "bg-blue-500 text-white"
                            : "bg-gray-100 text-gray-900"
                        }`}
                      >
                        <div className="text-sm break-words prose prose-sm max-w-none">
                          {message.role === "assistant" ? (
                            <>
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  // Custom styling for markdown elements
                                  p: ({ children }) => (
                                    <p className="mb-2 last:mb-0 break-words leading-relaxed">
                                      {children}
                                    </p>
                                  ),
                                  ul: ({ children }) => (
                                    <ul className="list-disc list-outside ml-4 mb-2 space-y-1">
                                      {children}
                                    </ul>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="list-decimal list-outside ml-4 mb-2 space-y-1">
                                      {children}
                                    </ol>
                                  ),
                                  li: ({ children }) => (
                                    <li className="leading-relaxed">
                                      {children}
                                    </li>
                                  ),
                                  strong: ({ children }) => (
                                    <strong className="font-bold text-gray-900">
                                      {children}
                                    </strong>
                                  ),
                                  em: ({ children }) => (
                                    <em className="italic">{children}</em>
                                  ),
                                  code: ({ children }) => (
                                    <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono">
                                      {children}
                                    </code>
                                  ),
                                  h1: ({ children }) => (
                                    <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 text-gray-900">
                                      {children}
                                    </h1>
                                  ),
                                  h2: ({ children }) => (
                                    <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-gray-900">
                                      {children}
                                    </h2>
                                  ),
                                  h3: ({ children }) => (
                                    <h3 className="text-sm font-bold mb-2 mt-2 first:mt-0 text-gray-900">
                                      {children}
                                    </h3>
                                  ),
                                  table: ({ children }) => (
                                    <div className="overflow-x-auto my-4">
                                      <table className="min-w-full border-collapse border border-gray-300 text-sm">
                                        {children}
                                      </table>
                                    </div>
                                  ),
                                  thead: ({ children }) => (
                                    <thead className="bg-gray-50">
                                      {children}
                                    </thead>
                                  ),
                                  tbody: ({ children }) => (
                                    <tbody className="bg-white">
                                      {children}
                                    </tbody>
                                  ),
                                  tr: ({ children }) => (
                                    <tr className="border-b border-gray-200">
                                      {children}
                                    </tr>
                                  ),
                                  th: ({ children }) => (
                                    <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-900 bg-gray-50">
                                      {children}
                                    </th>
                                  ),
                                  td: ({ children }) => (
                                    <td className="border border-gray-300 px-4 py-2 text-gray-700">
                                      {children}
                                    </td>
                                  ),
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                              <div className="flex items-center gap-1 mt-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() =>
                                    handleCopy(message.content, message.id)
                                  }
                                  title="Copy to clipboard"
                                >
                                  {copiedMessageId === message.id ? (
                                    <Check className="h-3.5 w-3.5 text-green-500" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={async () =>
                                    await handleExportText(
                                      message.content,
                                      message.sources
                                    )
                                  }
                                  title="Download as PDF"
                                >
                                  <FileDown className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="whitespace-pre-wrap">
                              {message.content}
                            </div>
                          )}
                        </div>
                        <div
                          className={`text-xs mt-1 flex items-center gap-2 ${
                            message.role === "user"
                              ? "text-blue-100"
                              : "text-gray-500"
                          }`}
                        >
                          <span>{formatTimestamp(message.timestamp)}</span>
                          {message.role === "assistant" &&
                            message.tokenCount && (
                              <span className="border-l border-gray-300 dark:border-gray-700 pl-2 flex items-center">
                                <span title="Input tokens">
                                  In:{" "}
                                  {message.tokenCount.input.toLocaleString()}
                                </span>
                                <span className="mx-1">|</span>
                                <span title="Output tokens">
                                  Out:{" "}
                                  {message.tokenCount.output.toLocaleString()}
                                </span>
                              </span>
                            )}
                        </div>
                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="text-xs font-medium text-gray-600">
                              Sources ({message.sources.length}):
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {/* Show initial sources or all if expanded */}
                              {(expandedSources[message.id]
                                ? message.sources
                                : message.sources.slice(
                                    0,
                                    INITIAL_SOURCES_SHOWN
                                  )
                              ).map((source, index) => (
                                <Link
                                  key={`${source.id}-${index}`}
                                  href={`/admin/files/${source.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block"
                                  title={`${source.title} (File: ${source.file_no})`}
                                >
                                  <Badge
                                    variant="secondary"
                                    className="text-xs hover:bg-blue-100 hover:text-blue-800 transition-colors cursor-pointer group max-w-xs"
                                  >
                                    <FileText className="h-3 w-3 mr-1 flex-shrink-0" />
                                    <span className="truncate">
                                      {truncateTitle(source.title, 35)}
                                    </span>
                                    <ExternalLink className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                  </Badge>
                                </Link>
                              ))}

                              {/* Show "Show more/less" button if there are more sources than the initial limit */}
                              {message.sources.length >
                                INITIAL_SOURCES_SHOWN && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    toggleSourceExpansion(message.id)
                                  }
                                  className="text-xs text-blue-600 hover:text-blue-800 py-1 h-auto"
                                >
                                  {expandedSources[message.id]
                                    ? `Show less`
                                    : `Show ${
                                        message.sources.length -
                                        INITIAL_SOURCES_SHOWN
                                      } more...`}
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-gray-200 text-gray-700">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="rounded-lg px-4 py-2 bg-gray-100">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching database and generating response...
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t p-4 flex-shrink-0">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask about database records..."
                disabled={isLoading}
                className="flex-1"
                maxLength={1000}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || isLoading}
                size="icon"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
              <span>{inputMessage.length}/1000 characters</span>
              {lastResponseMeta && (
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs">
                    Type: {lastResponseMeta.queryType}
                  </Badge>
                  {lastResponseMeta.analysisUsed && (
                    <Badge variant="outline" className="text-xs bg-green-50">
                      AI Analysis ✓
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
