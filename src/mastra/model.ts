// Gemma over any OpenAI-compatible endpoint. Default: Hugging Face Inference Providers.
// Same code runs on OpenRouter's free Gemma tier, Google AI Studio, or a self-hosted
// Ollama/vLLM box: only LLM_BASE_URL / LLM_API_KEY / LLM_MODEL change.
const apiKey = () => process.env.LLM_API_KEY || process.env.HF_TOKEN || "";
export const gemmaConfigured = () => !!apiKey();

const baseURL = () => process.env.LLM_BASE_URL || "https://router.huggingface.co/v1";

const config = (modelId: string) => ({
  providerId: "gemma-host",
  modelId,
  url: baseURL(),
  apiKey: apiKey() || "not-set",
  // OpenRouter uses these to attribute traffic; other hosts ignore them
  headers: { "HTTP-Referer": "https://github.com/stealth-raptor/LumiRoam", "X-Title": "LumiRoam" },
});

export const PRIMARY_MODEL = process.env.LLM_MODEL || "google/gemma-4-31B-it";
export const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || "google/gemma-4-26B-A4B-it";

/** Gemma 4 31B first; if its host is down or rate-limited, the 26B MoE takes over. */
export const gemma = [
  { model: config(PRIMARY_MODEL), maxRetries: 1 },
  { model: config(FALLBACK_MODEL), maxRetries: 1 },
];
