"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { UserRole } from "@/generated/prisma";
import { revalidatePath } from "next/cache";
import { LlamaParseDocumentParser } from "@/lib/llamaparse-document-parser";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { SemanticVectorService } from "../../../lib/semantic-vector";

// Upload directory configuration
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "documents");

function ensureUploadDirExists() {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

// Pagination + filtering types
export type GetFilesParams = {
  page?: number;
  pageSize?: number;
  q?: string;
  category?: string;
  year?: number; // calendar year from entry_date_real
};

export type PaginatedFiles = {
  items: FileListEntry[];
  total: number;
  page: number;
  pageSize: number;
};

// Server-side pagination + filtering for files list
export async function getFilesPaginated(params: GetFilesParams = {}): Promise<PaginatedFiles> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

  // Build where clause
  const where: any = {};

  if (params.category && params.category.trim() !== "") {
    where.category = params.category;
  }

  // Year filter -> between Jan 1 and Dec 31
  if (params.year && Number.isFinite(params.year)) {
    const y = params.year;
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));
    where.entry_date_real = {
      gte: start,
      lt: end,
    };
  }

  // Simple text search across file_no, title, category (case-insensitive)
  if (params.q && params.q.trim() !== "") {
    const q = params.q.trim();
    where.OR = [
      { file_no: { contains: q, mode: "insensitive" as const } },
      { title: { contains: q, mode: "insensitive" as const } },
      { category: { contains: q, mode: "insensitive" as const } },
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      prisma.fileList.count({ where }),
      prisma.fileList.findMany({
        where,
        orderBy: [
          { entry_date_real: "desc" },
          { id: "desc" },
        ],
        select: {
          id: true,
          file_no: true,
          category: true,
          title: true,
          entry_date_real: true,
          created_at: true,
          doc1: true,
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items: FileListEntry[] = rows.map((file) => ({
      ...file,
      entry_date_real: file.entry_date_real?.toISOString() || null,
      created_at: file.created_at?.toISOString() || null,
    }));

    return { items, total, page, pageSize };
  } catch (error) {
    console.error("Error fetching paginated files:", error);
    throw new Error("Failed to fetch files.");
  }
}

export type FileFilterOptions = {
  categories: string[];
  years: number[];
};

let filterOptionsCache: { data: FileFilterOptions; expiresAt: number } | null = null;

export async function clearFilterOptionsCache() {
  filterOptionsCache = null;
}

export async function getFilterOptions(): Promise<FileFilterOptions> {
  const now = Date.now();
  if (filterOptionsCache && filterOptionsCache.expiresAt > now) {
    return filterOptionsCache.data;
  }

  try {
    // Distinct categories via raw SQL to avoid Prisma validation on `not: null`
    const categoriesRows: Array<{ category: string | null }> = await prisma.$queryRaw`
      SELECT DISTINCT category
      FROM file_list
      WHERE category IS NOT NULL AND category <> ''
      ORDER BY category ASC
    `;
    const categories = categoriesRows
      .map((r) => r.category)
      .filter((c): c is string => typeof c === 'string' && c.trim() !== '');

    // Distinct years via raw SQL (faster than fetching all dates)
    const yearsRows: Array<{ year: number | null }> = await prisma.$queryRaw`
      SELECT DISTINCT EXTRACT(YEAR FROM entry_date_real)::int AS year
      FROM file_list
      WHERE entry_date_real IS NOT NULL
      ORDER BY year DESC
    `;
    const years = yearsRows
      .map((r) => (typeof r.year === "number" ? r.year : null))
      .filter((y): y is number => y !== null);

    const result: FileFilterOptions = { categories, years };
    filterOptionsCache = { data: result, expiresAt: now + 60000 };
    return result;
  } catch (error) {
    console.error("Error fetching filter options:", error);
    return { categories: [], years: [] };
  }
}

// Comprehensive HTML to plain text conversion for AI consumption
function htmlToPlainText(html: string | null | undefined): string | null {
  if (!html) return null;

  let text = html;

  // First, replace <br> tags with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Replace paragraph and div tags with double newlines for better separation
  text = text.replace(/<\/?(p|div)[^>]*>/gi, "\n\n");

  // Replace list items with newlines and bullets
  text = text.replace(/<li[^>]*>/gi, "\n• ");
  text = text.replace(/<\/li>/gi, "");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  const entityMap: { [key: string]: string } = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&rdquo;": '"',
    "&ldquo;": '"',
    "&middot;": "·",
    "&bull;": "•",
    "&ndash;": "–",
    "&mdash;": "—",
    "&hellip;": "…",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
    "&deg;": "°",
    "&plusmn;": "±",
    "&micro;": "µ",
    "&para;": "¶",
    "&sect;": "§",
    "&dagger;": "†",
    "&Dagger;": "‡",
    "&permil;": "‰",
    "&laquo;": "«",
    "&raquo;": "»",
    "&times;": "×",
    "&divide;": "÷",
  };

  // Replace known HTML entities
  for (const [entity, replacement] of Object.entries(entityMap)) {
    text = text.replace(new RegExp(entity, "gi"), replacement);
  }

  // Handle numeric HTML entities (&#123; or &#x1A;)
  text = text.replace(/&#(\d+);/g, (match, num) => {
    return String.fromCharCode(parseInt(num, 10));
  });

  text = text.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // Clean up excessive whitespace and newlines
  text = text.replace(/[ \t]+/g, " "); // Multiple spaces/tabs to single space
  text = text.replace(/\n\s*\n\s*\n/g, "\n\n"); // Multiple newlines to double newline
  text = text.replace(/^\s+|\s+$/g, ""); // Trim leading/trailing whitespace

  // Remove Windows line endings and normalize to Unix
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return text || null;
}

// Create complete plain text with file information prepended
const imagePlaceholder = "[Image removed - please upload images separately]";

const removeImagePlaceholder = (content: string | null | undefined): string => {
  if (!content) return "";
  // This regex replaces the placeholder, along with any surrounding whitespace (like empty paragraphs)
  return content
    .replace(
      new RegExp(
        imagePlaceholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
        "g"
      ),
      ""
    )
    .trim();
};

const createCompletePlainText = (
  fileNo: string,
  category: string,
  title: string,
  noteContent: string | null | undefined
): string | null => {
  // Create the file information header
  const fileInfo = `File No - ${fileNo}
Category - ${category}
Title - ${title}`;

  // Convert note HTML to plain text
  const notePlainText = htmlToPlainText(noteContent);

  // Combine file info with note content
  if (notePlainText && notePlainText.trim()) {
    return `${fileInfo}\n\n${notePlainText}`;
  } else {
    return fileInfo;
  }
};

// Zod schema for file validation
const fileSchema = z.object({
  file_no: z
    .string()
    .min(1, { message: "File No is required" })
    .max(100, { message: "File No must be 100 characters or less" }),
  category: z
    .string()
    .min(1, { message: "Category is required" })
    .max(500, { message: "Category must be 500 characters or less" }),
  title: z
    .string()
    .min(1, { message: "Title is required" })
    .max(500, { message: "Title must be 500 characters or less" }),
  note: z.string().optional(),
  // doc1 is removed from Zod schema; will be handled directly from FormData
  entry_date: z.string().optional().nullable(), // Input as string, will be converted to Date for entry_date_real
  content_format: z.enum(['html', 'markdown']).optional(), // Format of the note content
});

export type FileListEntry = {
  id: number;
  file_no: string;
  category: string;
  title: string;
  entry_date_real: string | null;
  created_at: string | null;
  doc1: string | null;
};

export async function getFiles(): Promise<FileListEntry[]> {
  try {
    const files = await prisma.fileList.findMany({
      orderBy: {
        entry_date_real: "desc", // Order by the actual date field
      },
      select: {
        // Select specific fields for the list view to optimize
        id: true,
        file_no: true,
        category: true,
        title: true,
        entry_date_real: true,
        created_at: true,
        doc1: true,
      },
    });
    // Convert Date objects to string to ensure serializability for client components
    return files.map((file) => ({
      ...file,
      entry_date_real: file.entry_date_real?.toISOString() || null,
      created_at: file.created_at?.toISOString() || null,
    }));
  } catch (error) {
    console.error("Error fetching files:", error);
    throw new Error("Failed to fetch files.");
  }
}

export interface CategoryListItem {
  id: number;
  file_no: string;
  category: string;
}

export async function getCategoryListItems(): Promise<CategoryListItem[]> {
  try {
    const items = await prisma.categoryList.findMany({
      select: {
        id: true,
        file_no: true,
        category: true,
      },
      orderBy: {
        file_no: "asc", // Or by category, as preferred
      },
    });
    return items;
  } catch (error) {
    console.error("Error fetching category list items:", error);
    return []; // Return empty array on error
  }
}

export type FileDetail = {
  id: number;
  file_no: string;
  category: string;
  title: string;
  note: string | null;
  doc1: string | null;
  entry_date: string | null;
  entry_date_real: string | null; // YYYY-MM-DD format for date input
  created_at: string | null;
  updated_at: string | null;
  content_format?: 'html' | 'markdown'; // Format of the note content
};

type PrismaFileSelectResult = {
  id: number;
  file_no: string;
  category: string;
  title: string;
  note: string | null;
  content_format: string | null;
  doc1: string | null;
  entry_date: string | null;
  entry_date_real: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
};

export async function getFileById(id: number): Promise<FileDetail | null> {
  try {
    const file = await prisma.fileList.findUnique({
      where: { id },
      select: {
        id: true,
        file_no: true,
        category: true,
        title: true,
        note: true,
        content_format: true,
        doc1: true,
        entry_date: true,
        entry_date_real: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!file) {
      return null;
    }

    // Cast the Prisma result to our expected type to help TypeScript.
    const selectedFile = file as PrismaFileSelectResult;

    return {
      id: selectedFile.id,
      file_no: selectedFile.file_no,
      category: selectedFile.category,
      title: selectedFile.title,
      note: selectedFile.note, // Prisma String? is string | null, FileDetail expects string | null
      content_format: selectedFile.content_format as 'html' | 'markdown' | undefined, // Include content_format
      doc1: selectedFile.doc1,
      entry_date: selectedFile.entry_date,
      // Format for <input type="date"> which expects YYYY-MM-DD or empty string
      entry_date_real:
        selectedFile.entry_date_real?.toISOString().split("T")[0] || "",
      created_at: selectedFile.created_at?.toISOString() || null,
      updated_at: selectedFile.updated_at?.toISOString() || null,
    };
  } catch (error) {
    console.error(`Error fetching file with id ${id}:`, error);
    throw new Error("Failed to fetch file details.");
  }
}

export type ActionResponse = {
  success: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function createFileAction(
  formData: FormData
): Promise<ActionResponse> {
  const session = await getServerSession(authOptions);
  if (
    !session ||
    !session.user ||
    (session.user.role !== UserRole.admin && session.user.role !== UserRole.staff)
  ) {
    return { success: false, error: "Unauthorized" };
  }
  ensureUploadDirExists();

  

  const file = formData.get("doc1") as File | null;
  const rawFormData = Object.fromEntries(formData.entries());
  if (file && file.size === 0) {
    delete rawFormData.doc1;
  }

  const validatedFields = fileSchema.safeParse(rawFormData);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Validation failed. Please check the fields.",
      fieldErrors: validatedFields.error.flatten().fieldErrors,
    };
  }

  let doc1Path: string | null = null;
  let finalNote = removeImagePlaceholder(validatedFields.data.note);

  if (file && file.size > 0) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const sanitizedOriginalName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = uniqueSuffix + "-" + sanitizedOriginalName;
      const filePath = path.join(UPLOAD_DIR, filename);
      await fs.writeFile(filePath, buffer);
      doc1Path = `/uploads/documents/${filename}`;
    } catch (error) {
      console.error("Error uploading file:", error);
      return { success: false, error: "File upload failed. Please try again." };
    }
  }

  const { note, entry_date, content_format, ...restOfData } = validatedFields.data;

  // Prefer the posted content_format (Option A). If not provided, infer from source
  // Fallback: file upload -> markdown, manual entry -> html
  const contentFormat = content_format ?? (file && file.size > 0 ? 'markdown' : 'html');


  let entryDateReal: Date | null = null;
  if (entry_date && entry_date.trim() !== "") {
    const parsedDate = new Date(entry_date);
    if (!isNaN(parsedDate.getTime())) {
      entryDateReal = parsedDate;
    }
  }

  try {
    // Create the file record with the final note content
    const newFile = await prisma.fileList.create({
      data: {
        ...restOfData,
        note: finalNote, // Use the potentially parsed content
        content_format: contentFormat, // Use posted format when provided; otherwise fallback
        doc1: doc1Path,
        entry_date: entry_date,
        entry_date_real: entryDateReal,
      },
    });


    // Manually update the search_vector using the correct note content
    await prisma.$executeRaw`
      UPDATE file_list 
      SET search_vector = to_tsvector('english', 
        COALESCE(file_no, '') || ' ' || 
        COALESCE(category, '') || ' ' || 
        COALESCE(title, '') || ' ' || 
        ${finalNote} || ' ' ||
        COALESCE(entry_date, '') || ' ' ||
        COALESCE(EXTRACT(YEAR FROM entry_date_real)::text, '')
      )
      WHERE id = ${newFile.id}
    `;

    // Generate and update semantic vector from the final note content
    if (finalNote && finalNote.trim().length > 0) {
      try {
        await SemanticVectorService.updateSemanticVector(newFile.id, finalNote);
      } catch (vectorError) {
        console.error("Semantic vector update failed:", vectorError);
        // Don't fail the entire operation if this fails
      }
    }

    clearFilterOptionsCache();
    revalidatePath("/admin/files");
    return {
      success: true,
      message: `File created successfully.`,
    };
  } catch (error) {
    console.error("Error creating file:", error);
    return { success: false, error: "Database error: Failed to create file." };
  }
}

export async function updateFileAction(
  id: number,
  formData: FormData
): Promise<ActionResponse> {
  const session = await getServerSession(authOptions);
  if (
    !session ||
    !session.user ||
    (session.user.role !== UserRole.admin && session.user.role !== UserRole.staff)
  ) {
    return { success: false, error: "Unauthorized" };
  }
  ensureUploadDirExists();

  // 1. Extract file and validate the rest of the form data
  const file = formData.get("doc1") as File | null;
  const rawFormData = Object.fromEntries(formData.entries());
  if (file && file.size === 0) {
    delete rawFormData.doc1;
  }

  const validatedFields = fileSchema.safeParse(rawFormData);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Validation failed. Please check the fields.",
      fieldErrors: validatedFields.error.flatten().fieldErrors,
    };
  }

  // 2. Prepare data for database update
  const { note, entry_date, content_format, ...restOfData } = validatedFields.data;
  let finalNote = removeImagePlaceholder(note);

  // Prefer the posted content_format (Option A). If not provided, infer from source
  // Fallback: file upload -> markdown, manual entry -> html
  const contentFormat = content_format ?? (file && file.size > 0 ? 'markdown' : 'html');


  let entryDateReal: Date | null = null;
  if (entry_date && entry_date.trim() !== "") {
    const parsedDate = new Date(entry_date);
    if (!isNaN(parsedDate.getTime())) {
      entryDateReal = parsedDate;
    }
  } else if (entry_date === "") {
    entryDateReal = null;
  }

  const prismaDataForUpdate: any = {
    ...restOfData,
    note: finalNote, // This will be overwritten by parsed content if a file is uploaded
    content_format: contentFormat, // Use posted format when provided; otherwise fallback
    entry_date: entry_date,
    entry_date_real: entryDateReal,
  };

  // 4. Handle file upload for update
  if (file && file.size > 0) {
    try {
      const existingFileRecord = await prisma.fileList.findUnique({
        where: { id },
        select: { doc1: true },
      });

      if (existingFileRecord?.doc1) {
        const oldFilePathServer = path.join(
          process.cwd(),
          "public",
          existingFileRecord.doc1
        );
        if (existsSync(oldFilePathServer)) {
          try {
            await fs.unlink(oldFilePathServer);
          } catch (delError) {
            console.error(
              `Error deleting old file ${oldFilePathServer}:`,
              delError
            );
          }
        }
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const sanitizedOriginalName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = uniqueSuffix + "-" + sanitizedOriginalName;
      const newFilePathOnServer = path.join(UPLOAD_DIR, filename);
      await fs.writeFile(newFilePathOnServer, buffer);
      prismaDataForUpdate.doc1 = `/uploads/documents/${filename}`;

      // The note field is already populated with the parsed content from the frontend,
      // so we just use that. The `finalNote` variable is updated from the form data
      // at the beginning of this function.
      prismaDataForUpdate.note = finalNote;
    } catch (error) {
      console.error("Error uploading file during update:", error);
      return {
        success: false,
        error: "File upload failed during update. Please try again.",
      };
    }
  }

  // 5. Update the file record in the database
  try {
    await prisma.fileList.update({
      where: { id },
      data: prismaDataForUpdate,
    });

    // 6. Update the search vector with the final note content
    await prisma.$executeRaw`
      UPDATE file_list 
      SET search_vector = to_tsvector('english', 
        COALESCE(file_no, '') || ' ' || 
        COALESCE(category, '') || ' ' || 
        COALESCE(title, '') || ' ' || 
        ${finalNote} || ' ' ||
        COALESCE(entry_date, '') || ' ' ||
        COALESCE(EXTRACT(YEAR FROM entry_date_real)::text, '')
      )
      WHERE id = ${id}
    `;

    // 7. Generate and update semantic vector from the final note content
    if (finalNote && finalNote.trim().length > 0) {
      try {
        await SemanticVectorService.updateSemanticVector(id, finalNote);
      } catch (vectorError) {
        console.error("❌ Semantic vector update failed:", vectorError);
        // Don't fail the entire operation if semantic vector fails
      }
    }

    clearFilterOptionsCache();
    revalidatePath("/admin/files");
    revalidatePath(`/admin/files/${id}/edit`);
    return {
      success: true,
      message: "File updated successfully with hybrid search capabilities.",
    };
  } catch (error) {
    console.error(`Error updating file ${id}:`, error);
    return { success: false, error: "Database error: Failed to update file." };
  }
}

export async function deleteFileAction(id: number): Promise<ActionResponse> {
  const session = await getServerSession(authOptions);
  if (
    !session ||
    !session.user ||
    session.user.role !== UserRole.admin
  ) {
    return { success: false, error: "Unauthorized" };
  }
  try {
    await prisma.fileList.delete({
      where: { id },
    });
    clearFilterOptionsCache();
    revalidatePath("/admin/files");
    return { success: true, message: "File deleted successfully." };
  } catch (error) {
    console.error(`Error deleting file ${id}:`, error);
    return { success: false, error: "Database error: Failed to delete file." };
  }
}
