import { Client } from "@gradio/client";
import { dbConfigured } from "./db";
import { findMedia, mediaKey, mediaUrl, putMedia } from "./media";

// Text-to-image with FLUX.1 [schnell] (Apache-2.0, 4 steps). Two free hosts, picked by T2I_PROVIDER:
//  - "cloudflare" (default): Workers AI, ~10k free neurons a day = well over 100 drawings.
//  - "hf-space": the official Hugging Face Space on ZeroGPU. Free, but each call reserves 90 s of
//    GPU and the free daily allowance is a few minutes, so only a handful of drawings a day.
const PROVIDER = () => (process.env.T2I_PROVIDER || "cloudflare") as "cloudflare" | "hf-space";
export const T2I_MODEL = () => "FLUX.1-schnell";

export const t2iConfigured = () =>
  PROVIDER() === "cloudflare"
    ? !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)
    : !!process.env.HF_TOKEN;

const SEED = 7; // fixed, so the same prompt always gives the same picture

async function drawCloudflare(prompt: string): Promise<{ data: Buffer; type: string }> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 4 }), // Workers AI rejects a seed; the GridFS cache keeps drawings stable
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; result?: { image?: string }; errors?: { message: string }[] } | null;
  if (!res.ok || !body?.result?.image) {
    throw new Error(`Cloudflare ${res.status}: ${body?.errors?.map((e) => e.message).join("; ") ?? "no image"}`);
  }
  return { data: Buffer.from(body.result.image, "base64"), type: "image/jpeg" };
}

let space: Promise<Client> | null = null;
async function drawHfSpace(prompt: string): Promise<{ data: Buffer; type: string }> {
  space ??= Client.connect(process.env.T2I_SPACE || "black-forest-labs/FLUX.1-schnell", {
    token: process.env.HF_TOKEN as `hf_${string}`,
  }).catch((e) => {
    space = null; // let the next call retry the connection
    throw e;
  });
  const app = await space;
  const res = await app.predict("/infer", { prompt, seed: SEED, randomize_seed: false, width: 768, height: 576, num_inference_steps: 4 });
  const out = (res.data as { url?: string }[])[0];
  if (!out?.url) throw new Error("the Space returned no image");
  const img = await fetch(out.url, { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  if (!img.ok) throw new Error(`image download ${img.status}`);
  return { data: Buffer.from(await img.arrayBuffer()), type: img.headers.get("content-type") || "image/webp" };
}

const draw = (prompt: string) => (PROVIDER() === "cloudflare" ? drawCloudflare(prompt) : drawHfSpace(prompt));

/**
 * Draw a prompt, or return the stored drawing if this exact prompt was drawn before.
 * Stored in MongoDB GridFS, so the free daily allowance is never spent twice on the same image.
 */
export async function drawPrompt(prompt: string, meta: Record<string, unknown> = {}): Promise<string> {
  if (!dbConfigured()) throw new Error("drawings are stored in MongoDB; set MONGODB_URI");
  const key = mediaKey("t2i", PROVIDER(), T2I_MODEL(), SEED, prompt);
  const hit = await findMedia(key);
  if (hit) return mediaUrl(hit);
  const out = await draw(prompt);
  const id = await putMedia(key, out.data, out.type, { kind: "drawing", model: T2I_MODEL(), prompt, ...meta });
  return mediaUrl(id);
}
