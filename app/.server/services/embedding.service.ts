/**
 * Embedding Service — CLIP image embeddings via Hugging Face Inference API.
 *
 * Instead of running the ONNX model locally (which requires 300-400 MB RAM
 * and glibc native binaries), we call the HF Inference API over HTTP.
 * This uses ~0 MB of local RAM for the model and works on any Node.js host.
 *
 * Model: openai/clip-vit-base-patch32
 * Output: 512-dimensional float32 vector in cosine similarity space.
 * Both product images and query images use the same model — embeddings are comparable.
 *
 * Required env var: HF_API_TOKEN  (free at https://huggingface.co/settings/tokens)
 */

const HF_MODEL_URL =
  "https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32";

/**
 * Generate a 512-dimensional CLIP embedding for an image buffer.
 * The buffer should be a preprocessed PNG (224×224, RGB) produced by sharp.
 */
export async function generateEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const token = process.env.HF_API_TOKEN;
  if (!token) {
    throw new Error(
      "HF_API_TOKEN environment variable is not set. " +
        "Get a free token at https://huggingface.co/settings/tokens",
    );
  }

  const response = await fetch(HF_MODEL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: imageBuffer,
    signal: AbortSignal.timeout(30_000), // 30 s — model may need a cold-start
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    // HF returns 503 with {"error":"Loading...","estimated_time":N} on cold start
    if (response.status === 503) {
      throw new Error(
        `HF model is loading (cold start). Please retry in ~20 s. Details: ${body}`,
      );
    }
    throw new Error(`HF API error ${response.status}: ${body}`);
  }

  const result: unknown = await response.json();

  // Validate and unwrap the result.
  // HF returns [[...512 floats...]] (nested) for a single image.
  if (!Array.isArray(result)) {
    throw new Error(`Unexpected HF API response shape: ${JSON.stringify(result)}`);
  }

  // Unwrap one level of nesting if needed: [[f, f, ...]] → [f, f, ...]
  const embedding = Array.isArray(result[0]) ? (result[0] as number[]) : (result as number[]);

  if (embedding.length !== 512) {
    throw new Error(
      `Expected 512-dim embedding from CLIP, got ${embedding.length} dims`,
    );
  }

  return embedding;
}

/**
 * No-op warm-up: HF Inference API handles model loading server-side.
 * Kept for interface compatibility with entry.server.tsx.
 */
export async function warmupEmbeddingPipeline(): Promise<void> {
  console.log(
    "[ImageSearch] Embeddings via HF Inference API — no local warmup needed.",
  );
}
