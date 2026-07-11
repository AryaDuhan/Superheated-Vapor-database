type Pipeline = (
  texts: string[],
  options?: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let embedder: Pipeline | null = null;
let loading: Promise<Pipeline> | null = null;

async function getEmbedder(): Promise<Pipeline> {
  if (embedder) return embedder;
  if (!loading) {
    loading = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      embedder = (await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      )) as Pipeline;
      return embedder;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

export async function embedText(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const output = await model([text], { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export function toHalfvecLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
