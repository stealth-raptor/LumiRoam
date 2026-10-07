// Gemma through Hugging Face Inference Providers: an OpenAI-compatible router in front of
// providers like Novita and DeepInfra. Open weights, pay-per-token, no GPU to babysit.
// Model and base URL are env-configurable, so swapping models or moving to a self-hosted
// OpenAI-compatible server (Ollama, vLLM) is an env change, not a code change.
export const gemmaConfigured = () => !!process.env.HF_TOKEN;

const baseURL = () => process.env.LLM_BASE_URL ?? "https://router.huggingface.co/v1";

const config = (modelId: string) => ({
  providerId: "hf-router",
  modelId,
  url: baseURL(),
  apiKey: process.env.HF_TOKEN ?? "not-set",
});

export const PRIMARY_MODEL = process.env.LLM_MODEL ?? "google/gemma-4-31B-it";
export const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL ?? "google/gemma-4-26B-A4B-it";

/** Gemma 4 31B first; if its providers are down or rate-limited, the 26B MoE takes over. */
export const gemma = [
  { model: config(PRIMARY_MODEL), maxRetries: 1 },
  { model: config(FALLBACK_MODEL), maxRetries: 1 },
];
