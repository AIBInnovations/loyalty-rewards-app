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
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

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

// ── Sharp fallback (color histogram + pixel grid) ─────────────────────────────

async function generateEmbeddingSharp(imageBuffer: Buffer): Promise<number[]> {
  const { default: sharp } = await import("sharp");

  const grayData = await sharp(imageBuffer)
    .resize(16, 16, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();
  const structural = Array.from(grayData).map((v) => v / 255.0);

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

  const combined = [...structural, ...colorHist];
  const norm = Math.sqrt(combined.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? combined.map((v) => v / norm) : combined;
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
