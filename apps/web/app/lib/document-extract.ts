/**
 * Client-side text extraction for "draft a workflow from a document" — PDF.js and mammoth both
 * run in the browser, so a SOP document never leaves it as a file: only the extracted plain text
 * is sent to /workflows/generate, which already accepts an arbitrary string. No new backend route,
 * no upload endpoint, no file ever touches the control plane.
 */

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB — generous for a procedure document, not for a scan dump
const MAX_EXTRACTED_CHARS = 20_000; // keeps the SOP-generation prompt (and its Bedrock cost) bounded

export class DocumentExtractError extends Error {}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Webpack (and Next's static export build) resolves this `new URL(...)` to a real asset under
  // /_next/static and rewrites the import accordingly — the standard pdf.js + bundler pattern.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: buffer });
  try {
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push(text);
    }
    return pages.join("\n\n");
  } finally {
    await loadingTask.destroy();
  }
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

export type ExtractResult = { text: string; truncated: boolean };

/** Extracts plain text from a PDF, DOCX, or plain-text file. Throws DocumentExtractError on anything it can't handle. */
export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  if (file.size === 0) {
    throw new DocumentExtractError("That file is empty.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new DocumentExtractError(
      `That file is too large (${Math.round(file.size / 1024 / 1024)} MB) — try one under ${MAX_FILE_BYTES / 1024 / 1024} MB, or paste the relevant section as text instead.`,
    );
  }

  const ext = extensionOf(file.name);
  let raw: string;
  try {
    if (ext === "pdf") {
      raw = await extractPdfText(await file.arrayBuffer());
    } else if (ext === "docx") {
      raw = await extractDocxText(await file.arrayBuffer());
    } else if (ext === "txt" || ext === "md") {
      raw = await file.text();
    } else if (ext === "doc") {
      throw new DocumentExtractError(
        "Older .doc files aren't supported — save it as .docx or .pdf and try again.",
      );
    } else {
      throw new DocumentExtractError(
        `AmazFlow can't read .${ext || "that"} files yet — try a PDF, Word (.docx), or plain text file.`,
      );
    }
  } catch (error) {
    if (error instanceof DocumentExtractError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new DocumentExtractError(`Couldn't read that file: ${message}`);
  }

  const text = raw.trim();
  if (!text) {
    throw new DocumentExtractError(
      "No readable text came out of that file — it may be a scanned image rather than real text.",
    );
  }

  const truncated = text.length > MAX_EXTRACTED_CHARS;
  return { text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text, truncated };
}
