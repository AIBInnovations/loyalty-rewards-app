/**
 * Embedding Service — 512-dim visual feature vector using sharp only.
 *
 * No ML model, no native ONNX binary, no external API, no API key.
 * Works on any Node.js host within ~50 MB RAM.
 *
 * Vector layout (512 dims, L2-normalized → cosine-similarity compatible):
 *   [0..255]   — 16×16 grayscale downscale (structural / shape features)
 *   [256..511] — 256-bin RGB color histogram (color distribution features)
 *
 * Both query images and indexed product images use the same function,
 * so cosine similarity between any two vectors is meaningful.
 */

/**
 * Generate a 512-dimensional visual feature vector for an image buffer.
 * The buffer can be any format that sharp supports (JPEG, PNG, WebP, etc.).
 */
export async function generateEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const { default: sharp } = await import("sharp");

  // ── 1. Structural features: 16×16 grayscale → 256 floats ─────────────────
  const grayData = await sharp(imageBuffer)
    .resize(16, 16, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const structural = Array.from(grayData).map((v) => v / 255.0);

  // ── 2. Color histogram: 256-bin RGB → 256 floats ─────────────────────────
  // 8 bins × R, 8 bins × G, 4 bins × B  →  8 × 8 × 4 = 256 bins
  const rgbData = await sharp(imageBuffer)
    .resize(32, 32, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const hist = new Float32Array(256).fill(0);
  const pixelCount = rgbData.length / 3;

  for (let i = 0; i < rgbData.length; i += 3) {
    const r = Math.min(7, Math.floor(rgbData[i] / 32));
    const g = Math.min(7, Math.floor(rgbData[i + 1] / 32));
    const b = Math.min(3, Math.floor(rgbData[i + 2] / 64));
    hist[r * 32 + g * 4 + b] += 1;
  }

  const colorHist = Array.from(hist).map((v) => v / pixelCount);

  // ── 3. Combine and L2-normalize → 512-dim unit vector ────────────────────
  const combined = [...structural, ...colorHist];
  const norm = Math.sqrt(combined.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? combined.map((v) => v / norm) : combined;
}

/**
 * No-op warm-up — sharp loads instantly, no model weights to download.
 * Kept for interface compatibility with entry.server.tsx.
 */
export async function warmupEmbeddingPipeline(): Promise<void> {
  console.log("[ImageSearch] Embedding via sharp visual features — ready.");
}
