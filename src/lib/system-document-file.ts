/**
 * The file a System can upload for a Document Requirement instead of (or as well as) a link (#324, product-owner
 * decision). Pure and Prisma-free so the Documentation tab checks the same rules before it uploads.
 */

/** The largest file accepted: 4 MB, because Vercel serverless functions refuse request bodies over 4.5 MB. */
export const MAX_DOCUMENT_FILE_BYTES = 4 * 1024 * 1024;

/**
 * What may be uploaded: PDF, Word, Excel, PowerPoint, PNG, JPEG, plain text and Markdown. Each extension lists the
 * content types a browser may declare for it; the first is the one stored and served. Anything else is refused (415).
 * Markdown is often declared as plain text, as nothing, or as a generic binary, so those are accepted for `.md` only.
 */
export const ALLOWED_DOCUMENT_FILE_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain", "application/octet-stream", ""],
};

/** The `accept` attribute for the file picker. */
export const DOCUMENT_FILE_ACCEPT = Object.keys(ALLOWED_DOCUMENT_FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

export const DOCUMENT_FILE_TYPES_TEXT = "PDF, Word, Excel, PowerPoint, PNG, JPEG, plain text or Markdown";
export const DOCUMENT_FILE_TOO_LARGE = `The file is larger than ${MAX_DOCUMENT_FILE_BYTES / (1024 * 1024)} MB.`;
export const DOCUMENT_FILE_TYPE_REFUSED = `That file type isn't accepted. Upload ${DOCUMENT_FILE_TYPES_TEXT}.`;
export const DOCUMENT_FILE_EMPTY = "The file is empty.";
export const DOCUMENT_FILE_NAME_MAX = 255;

export type DocumentFileCheck = { ok: true; contentType: string } | { ok: false; status: 400 | 413 | 415; error: string };

/** Checks a file's name, declared content type and size against the rules above; `contentType` is what to store. */
export function checkDocumentFile(file: { name: string; type: string; size: number }): DocumentFileCheck {
  if (!file.name || file.name.length > DOCUMENT_FILE_NAME_MAX) return { ok: false, status: 400, error: `The file needs a name of at most ${DOCUMENT_FILE_NAME_MAX} characters.` };
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const types = Object.prototype.hasOwnProperty.call(ALLOWED_DOCUMENT_FILE_TYPES, extension) ? ALLOWED_DOCUMENT_FILE_TYPES[extension] : undefined;
  if (!types || !types.includes(file.type.split(";")[0].trim().toLowerCase())) return { ok: false, status: 415, error: DOCUMENT_FILE_TYPE_REFUSED };
  if (file.size > MAX_DOCUMENT_FILE_BYTES) return { ok: false, status: 413, error: DOCUMENT_FILE_TOO_LARGE };
  if (file.size === 0) return { ok: false, status: 400, error: DOCUMENT_FILE_EMPTY };
  return { ok: true, contentType: types[0] };
}

/** A size for people: "812 B", "34 KB", "1.2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
