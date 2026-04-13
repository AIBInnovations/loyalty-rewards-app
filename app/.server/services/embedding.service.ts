/**
 * Embedding Service — CLIP-based image embedding using @xenova/transformers.
 *
 * Uses a module-level singleton so the model is loaded once at server startup
 * (via warmupEmbeddingPipeline()) and reused for all requests. This avoids the
 * 3-5 second cold-start on the first customer search.
 *
 * Model: Xenova/clip-vit-base-patch32 (quantized)
 * Output: 512-dimensional float32 vector in cosine similarity space.
 * Both product images and query images use the same model so embeddings are comparable.
 */

let pipelineInstance: any = null;
let loadPromise: Promise<any> | null = null;

export async function getEmbeddingPipeline(): Promise<any> {
  if (pipelineInstance) return pipelineInstance;

  // Deduplicate concurrent calls during startup warm-up
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { pipeline } = await import("@xenova/transformers");
    pipelineInstance = await pipeline(
      "image-feature-extraction",
      "Xenova/clip-vit-base-patch32",
      { quantized: true }, // ~80 MB RAM — fits Render.com free tier (512 MB limit)
    );
    return pipelineInstance;
  })();

  return loadPromise;
}

/**
 * Call at server startup to pre-load model weights.
 * Fire-and-forget — do not await in entry.server.tsx.
 */
export async function warmupEmbeddingPipeline(): Promise<void> {
  try {
    await getEmbeddingPipeline();
    console.log("[ImageSearch] CLIP pipeline warmed up successfully");
  } catch (err) {
    console.error("[ImageSearch] Failed to warm up CLIP pipeline:", err);
  }
}

/**
 * Generate a 512-dimensional CLIP embedding for an image buffer.
 * The buffer should be a preprocessed PNG (224×224, RGB) produced by sharp.
 */
export async function generateEmbedding(imageBuffer: Buffer): Promise<number[]> {
  const { RawImage } = await import("@xenova/transformers");
  const pipe = await getEmbeddingPipeline();

  // Convert to Uint8Array to satisfy TypeScript's BlobPart constraint
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: "image/png" });
  const image = await RawImage.fromBlob(blob);

  const output = await pipe(image, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
