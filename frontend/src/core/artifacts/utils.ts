import { getBackendBaseURL } from "../config";
import type { AgentThread } from "../threads";

export type ArtifactExportFormat = "pdf" | "docx";
export type ArtifactDownloadFormat = ArtifactExportFormat | "md";

export function urlOfArtifact({
  filepath,
  threadId,
  download = false,
  isMock = false,
}: {
  filepath: string;
  threadId: string;
  download?: boolean;
  isMock?: boolean;
}) {
  if (isMock) {
    return `${getBackendBaseURL()}/mock/api/threads/${threadId}/artifacts${filepath}${download ? "?download=true" : ""}`;
  }
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts${filepath}${download ? "?download=true" : ""}`;
}

export function urlOfArtifactExport({
  filepath,
  threadId,
  format,
}: {
  filepath: string;
  threadId: string;
  format: ArtifactExportFormat;
}) {
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts/export${filepath}?format=${format}`;
}

export async function downloadArtifact({
  filepath,
  threadId,
  format,
}: {
  filepath: string;
  threadId: string;
  format: ArtifactDownloadFormat;
}) {
  const response = await fetch(
    format === "md"
      ? urlOfArtifact({ filepath, threadId, download: true })
      : urlOfArtifactExport({ filepath, threadId, format }),
  );

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({
        detail:
          format === "md"
            ? "Failed to download artifact"
            : "Failed to export artifact",
      }));
    throw new Error(
      error.detail
        ?? (format === "md"
          ? "Failed to download artifact"
          : "Failed to export artifact"),
    );
  }

  const blob = await response.blob();
  const filename =
    filenameFromContentDisposition(response.headers.get("Content-Disposition"))
    ?? fallbackDownloadFilename(filepath, format);
  triggerBlobDownload(blob, filename);
}

export async function exportArtifact({
  filepath,
  threadId,
  format,
}: {
  filepath: string;
  threadId: string;
  format: ArtifactExportFormat;
}) {
  await downloadArtifact({ filepath, threadId, format });
}

export function extractArtifactsFromThread(thread: AgentThread) {
  return thread.values.artifacts ?? [];
}

export function resolveArtifactURL(absolutePath: string, threadId: string) {
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts${absolutePath}`;
}

function filenameFromContentDisposition(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const fallbackMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return fallbackMatch?.[1] ?? null;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function fallbackDownloadFilename(
  filepath: string,
  format: ArtifactDownloadFormat,
) {
  const filename = filepath.split("/").pop() ?? "artifact.md";
  if (format === "md") {
    return filename;
  }
  return filename.replace(/\.[^.]+$/, `.${format}`);
}
