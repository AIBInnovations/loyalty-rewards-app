/**
 * Embedding Service — 512-dim CLIP embeddings via Hugging Face Inference API.
 *
 * Uses openai/clip-vit-base-patch32 via HF free inference API when
 * HF_API_TOKEN env var is set. Falls back to sharp color/structure
 * features when the token is missing or the API call fails.
 *
 * CLIP understands image content semantically — a photo of a dress
 * matches other dresses, not just images with similar colors.
 */

const HF_MODEL = "openai/clip-vit-base-patch32";
// HuggingFace migrated from api-inference.huggingface.co → router.huggingface.co
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

// ── CLIP via Hugging Face Inference API ───────────────────────────────────────

async function generateEmbeddingHF(
  imageBuffer: Buffer,
  token: string,
): Promise<number[]> {
  const resp = await fetch(HF_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: imageBuffer,
    signal: AbortSignal.timeout(30_000),
  });

  if (resp.status === 503) {
    // Model is loading — wait and retry once
    const retryAfter = parseInt(resp.headers.get("X-Wait-For-Model") || "20", 10);
    console.log(`[ImageSearch] HF model loading, retrying in ${retryAfter}s…`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));

    const retry = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
      signal: AbortSignal.timeout(30_000),
    });
    if (!retry.ok) {
      throw new Error(`HF API retry ${retry.status}: ${await retry.text()}`);
    }
    const data = await retry.json() as any;
    return extractEmbedding(data);
  }

  if (!resp.ok) {
    throw new Error(`HF API ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as any;
  return extractEmbedding(data);
}

function extractEmbedding(data: any): number[] {
  // CLIP feature-extraction returns [[...512 floats...]]
  const raw: number[] = Array.isArray(data[0]) ? data[0] : data;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Unexpected HF response shape: ${JSON.stringify(data).slice(0, 200)}`);
  }
  // L2-normalize so cosine similarity works correctly
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? raw.map((v) => v / norm) : raw;
}

// ── Sharp fallback: spatial color histogram ───────────────────────────────────
//
// Divides the image into a 4×4 grid (16 cells) and computes a 32-bin color
// histogram per cell → 512 dims total. This is far more discriminative than a
// global histogram because it captures WHERE colours appear in the image.
//
// Why this matters:
//   • Studio product photos (white background) → white in corners, colour in centre.
//   • Food/landscape/random images → colours distributed uniformly across all cells.
// A global histogram loses this spatial signal entirely; per-cell does not.

async function generateEmbeddingSharp(imageBuffer: Buffer): Promise<number[]> {
  const { default: sharp } = await import("sharp");

  const SIZE = 64;   // resize target (64×64 px)
  const GRID = 4;    // 4×4 spatial grid  →  16 cells
  const BINS = 32;   // 32 colour bins per cell  (4 R × 4 G × 2 B)
  const CELL = SIZE / GRID; // 16 px per cell side

  const rgbData = await sharp(imageBuffer)
    .resize(SIZE, SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const hist = new Float32Array(GRID * GRID * BINS).fill(0);
  const pixelsPerCell = CELL * CELL;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cellY = Math.floor(y / CELL);
      const cellX = Math.floor(x / CELL);
      const cellIdx = cellY * GRID + cellX;

      const base = (y * SIZE + x) * 3;
      const rBin = Math.min(3, Math.floor(rgbData[base]     / 64)); // 0-3
      const gBin = Math.min(3, Math.floor(rgbData[base + 1] / 64)); // 0-3
      const bBin = Math.min(1, Math.floor(rgbData[base + 2] / 128)); // 0-1

      const bin = rBin * 8 + gBin * 2 + bBin; // 0-31
      hist[cellIdx * BINS + bin] += 1 / pixelsPerCell; // normalise per cell
    }
  }

  const arr = Array.from(hist);
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? arr.map((v) => v / norm) : arr;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const token = process.env.HF_API_TOKEN;

  if (token) {
    try {
      const embedding = await generateEmbeddingHF(imageBuffer, token);
      console.log(`[ImageSearch] CLIP embedding generated (${embedding.length} dims)`);
      return embedding;
    } catch (e) {
      console.warn("[ImageSearch] HF CLIP failed, falling back to sharp:", e);
    }
  } else {
    console.warn("[ImageSearch] HF_API_TOKEN not set — using basic sharp embeddings (low accuracy)");
  }

  return generateEmbeddingSharp(imageBuffer);
}

export async function warmupEmbeddingPipeline(): Promise<void> {
  const token = process.env.HF_API_TOKEN;
  if (token) {
    console.log("[ImageSearch] CLIP via Hugging Face API — ready.");
  } else {
    console.log("[ImageSearch] No HF_API_TOKEN — using sharp fallback embeddings.");
  }
}
