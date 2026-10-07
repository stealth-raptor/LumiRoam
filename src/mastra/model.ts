// Gemma runs on our own GPU Droplet behind Ollama's OpenAI-compatible API.
// Swapping models is an env change: GEMMA_MODEL=gemma4:26b, or point GEMMA_BASE_URL elsewhere.
export const gemmaConfigured = () => !!process.env.GEMMA_BASE_URL;

export const gemma = {
  providerId: "lumiroam-gpu",
  modelId: process.env.GEMMA_MODEL ?? "gemma4:e4b",
  url: process.env.GEMMA_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: process.env.GEMMA_API_KEY ?? "not-set",
} as const;
