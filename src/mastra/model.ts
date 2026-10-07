import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Gemma over any OpenAI-compatible endpoint. Default: Hugging Face Inference Providers.
// Same code runs on Cloudflare Workers AI, OpenRouter's free Gemma tier, or a self-hosted
// Ollama/vLLM box: only LLM_BASE_URL / LLM_API_KEY / LLM_MODEL change.
const apiKey = () => process.env.LLM_API_KEY || process.env.HF_TOKEN || "";
export const gemmaConfigured = () => !!apiKey();

export const PRIMARY_MODEL = process.env.LLM_MODEL || "google/gemma-4-31B-it";
export const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || "google/gemma-4-26B-A4B-it";

// Extra fields for every chat request. Default: switch off Gemma 4's "thinking" phase. On
// Cloudflare it made a 50-word story take ~40 s and cost ~4x the neurons; without it ~1.5 s.
// Set LLM_EXTRA_BODY={} for hosts that reject unknown fields.
function extraBody(): Record<string, unknown> {
  try {
    return JSON.parse(process.env.LLM_EXTRA_BODY || '{"chat_template_kwargs":{"enable_thinking":false}}');
  } catch {
    return {};
  }
}

const withExtraBody: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), ...extraBody() }) };
    } catch {
      // not JSON: send as-is
    }
  }
  return fetch(input, init);
};

const provider = () =>
  createOpenAICompatible({
    name: "gemma-host",
    baseURL: process.env.LLM_BASE_URL || "https://router.huggingface.co/v1",
    apiKey: apiKey() || "not-set",
    // OpenRouter uses these to attribute traffic; other hosts ignore them
    headers: { "HTTP-Referer": "https://github.com/stealth-raptor/LumiRoam", "X-Title": "LumiRoam" },
    fetch: withExtraBody,
  });

/** Gemma 4 first; if its host is down or rate-limited, the fallback model takes over. */
export const gemma = [
  { model: provider().chatModel(PRIMARY_MODEL), maxRetries: 1 },
  { model: provider().chatModel(FALLBACK_MODEL), maxRetries: 1 },
];
