/**
 * Multipart image parser for Remix (Fetch API Request objects).
 *
 * Remix uses the Web Fetch API — its Request.body is a ReadableStream, not a
 * Node.js Readable. Multer is Express-only so we use busboy directly, piping
 * the Fetch stream via Readable.fromWeb().
 *
 * Returns null if:
 *  - Content-Type is not multipart/form-data
 *  - No image field found
 *  - File exceeds 5 MB
 *  - MIME type is not jpeg / png / webp
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const busboy = require("busboy");
import { createHash } from "crypto";
import { Readable } from "stream";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface ParsedImage {
  buffer: Buffer;
  mimeType: string;
  hash: string; // SHA-256 of raw uploaded bytes — used for cache-busting in indexer
}

export async function parseMultipartImage(
  request: Request,
): Promise<ParsedImage | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return null;

  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    });

    let settled = false;

    const settle = (result: ParsedImage | null) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    bb.on("file", (_fieldname: string, fileStream: any, info: any) => {
      if (!ALLOWED_MIME_TYPES.includes(info.mimeType)) {
        fileStream.resume(); // drain and discard
        settle(null);
        return;
      }

      const chunks: Buffer[] = [];

      fileStream.on("data", (chunk: Buffer) => chunks.push(chunk));

      fileStream.on("limit", () => {
        // File exceeded MAX_FILE_SIZE — drain remaining bytes then resolve null
        fileStream.resume();
        settle(null);
      });

      fileStream.on("end", () => {
        if (settled) return;
        const buffer = Buffer.concat(chunks);
        const hash = createHash("sha256").update(buffer).digest("hex");
        settle({ buffer, mimeType: info.mimeType, hash });
      });

      fileStream.on("error", reject);
    });

    bb.on("error", reject);

    bb.on("close", () => settle(null));

    const body = request.body;
    if (!body) {
      settle(null);
      return;
    }

    // Bridge Web ReadableStream → Node.js Readable → busboy
    Readable.fromWeb(body as any).pipe(bb);
  });
}
