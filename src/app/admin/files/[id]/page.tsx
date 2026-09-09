import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth-options";
import { UserRole } from "@/generated/prisma";
import { getFileById, FileDetail } from "../actions"; // Corrected path to actions.ts
import BackButton from "@/components/ui/BackButton"; // Corrected import for default export
import { Button } from "@/components/ui/button";
import { Pencil, FileText } from "lucide-react";
import { pageContainer, pageTitle, cardContainer } from "@/styles/ui-classes";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { isHtmlContent } from "@/lib/contentFormatDetector";

interface DetailItemProps {
  label: string;
  value?: string | null;
  isMarkdown?: boolean;
  contentFormat?: 'html' | 'markdown' | 'auto';
}

const DetailItem: React.FC<DetailItemProps> = ({
  label,
  value,
  isMarkdown = false,
  contentFormat = 'auto',
}) => {
  if (value === null || value === undefined || value.trim() === "") return null;

  // Determine if content is HTML or markdown
  // If contentFormat is explicitly set, use that, otherwise auto-detect
  const isHtml = contentFormat === 'html' || 
                (contentFormat === 'auto' && isHtmlContent(value));
  
  // For backward compatibility, also check isMarkdown prop
  const shouldRenderAsMarkdown = contentFormat === 'markdown' || (!isHtml && isMarkdown);

  return (
    <div className="mb-4 pt-4 first:pt-0">
      <h3 className="text-sm font-medium text-gray-500">{label}</h3>
      {isHtml ? (
        // Render HTML content
        <div 
          className="mt-1 text-md text-gray-900 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: value }}
        />
      ) : shouldRenderAsMarkdown ? (
        // Render markdown content
        <div className="mt-1 text-md text-gray-900 prose prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              // Custom styling for markdown elements
              sup: ({ children }) => (
                <sup className="text-[0.75em] leading-none align-super font-normal text-gray-900">
                  {children}
                </sup>
              ),
              sub: ({ children }) => (
                <sub className="text-[0.75em] leading-none align-sub font-normal text-gray-900">
                  {children}
                </sub>
              ),
              u: ({ children }) => <u className="underline underline-offset-2">{children}</u>,
              del: ({ children }) => <del className="line-through text-gray-500">{children}</del>,
              mark: ({ children }) => (
                <mark className="bg-yellow-200 px-1 py-0.5 rounded">{children}</mark>
              ),
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
                <li className="leading-relaxed">{children}</li>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-gray-900">
                  {children}
                </strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              code: ({ children }) => (
                <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              ),
              h1: ({ children }) => (
                <h1 className="text-lg font-bold mb-2 text-gray-900">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-base font-semibold mb-2 text-gray-900">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold mb-1 text-gray-900">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-sm font-semibold mb-1 text-gray-900">
                  {children}
                </h4>
              ),
              h5: ({ children }) => (
                <h5 className="text-sm font-semibold mb-1 text-gray-900">
                  {children}
                </h5>
              ),
              h6: ({ children }) => (
                <h6 className="text-sm font-semibold mb-1 text-gray-900">
                  {children}
                </h6>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-4">
                  <table className="min-w-full border-collapse border border-gray-300 text-sm">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-gray-50">{children}</thead>
              ),
              tbody: ({ children }) => (
                <tbody className="bg-white">{children}</tbody>
              ),
              tr: ({ children }) => (
                <tr className="border-b border-gray-200">{children}</tr>
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
            {value}
          </ReactMarkdown>

          {/* Debug section - show raw content if it doesn't look like markdown */}
          {!value.includes("**") &&
            !value.includes("#") &&
            !value.includes("|") && (
              <details className="mt-4 p-2 bg-gray-50 rounded text-xs">
                <summary className="cursor-pointer font-medium text-gray-600">
                  Raw Content (Debug)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-gray-700">
                  {value}
                </pre>
              </details>
            )}
        </div>
      ) : (
        <p className="mt-1 text-md text-gray-900 whitespace-pre-wrap">
          {value}
        </p>
      )}
    </div>
  );
};

export default async function ViewFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (
    !session ||
    !session.user ||
    (session.user.role !== UserRole.admin && session.user.role !== UserRole.staff)
  ) {
    redirect("/unauthorized");
  }

  // In Next.js 15, we need to await params before accessing its properties
  const resolvedParams = await params;
  const id = parseInt(resolvedParams.id, 10);
  if (isNaN(id)) {
    return (
      <div className={pageContainer}>
        <p className="text-red-500 p-4">Invalid file ID.</p>
      </div>
    );
  }

  let file: FileDetail | null = null;
  let error: string | null = null;

  try {
    file = await getFileById(id);
  } catch (err) {
    console.error(`Failed to fetch file ${id}:`, err);
    error = `Failed to load file data. Error: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  if (error) {
    return (
      <div className={pageContainer}>
        <p className="text-red-500 p-4">{error}</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div className={pageContainer}>
        <p className="text-center p-4">File not found.</p>
      </div>
    );
  }

  return (
    <div className={pageContainer}>
      <div className="flex justify-between items-center mb-6">
        <h1 className={pageTitle}>File Details</h1>
        <div className="flex gap-2">
          {file.doc1 && (
            <Button
              asChild
              variant="default"
              className="bg-blue-600 hover:bg-blue-700"
            >
              <a href={file.doc1} target="_blank" rel="noopener noreferrer">
                <FileText className="h-4 w-4 mr-2" />
                View Document
              </a>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={`/admin/files/${file.id}/edit`}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Link>
          </Button>
          <BackButton href="/admin/files" />
        </div>
      </div>
      <div className={cardContainer}>
        <div className="px-4 py-5 sm:p-6">
          {" "}
          {/* Adjusted padding and removed divider for DetailItem's own top border/padding */}
          <DetailItem label="File No" value={file.file_no} />
          <DetailItem label="Category" value={file.category} />
          <DetailItem label="Title" value={file.title} />
          {file.entry_date_real && (
            <DetailItem
              label="Entry Date"
              value={format(new Date(file.entry_date_real), "PPP")}
            />
          )}
          {file.entry_date && file.entry_date_real !== file.entry_date && (
            <DetailItem
              label="Original Entry Date String"
              value={file.entry_date}
            />
          )}
          <DetailItem
            label="Document Content"
            value={file.note}
            contentFormat={(file.content_format as 'html' | 'markdown') || 'auto'}
          />
          {file.doc1 && (
            <DetailItem label="Document (File Path)" value={file.doc1} />
          )}
          {file.created_at && (
            <DetailItem
              label="Created At"
              value={format(new Date(file.created_at), "PPP p")}
            />
          )}
          {file.updated_at && (
            <DetailItem
              label="Last Updated At"
              value={format(new Date(file.updated_at), "PPP p")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
