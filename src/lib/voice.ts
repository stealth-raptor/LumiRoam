import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { cachedMedia, mediaKey } from "./media";

export const voiceConfigured = () => !!process.env.ELEVENLABS_API_KEY;

let client: ElevenLabsClient | null = null;

const VOICE_ID = () => process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // George: calm, narrative
const VOICE_MODEL = () => process.env.ELEVENLABS_MODEL || "eleven_v4";

/**
 * Speak `text` and store the MP3 in MongoDB GridFS. The same sentence in the same voice is
 * reused: "You're at your planned spot for Tower Bridge…" on a second walk costs no credits.
 * Returns the GridFS id, so the walk diary can replay every clip afterwards.
 */
export async function speakCached(text: string, meta: Record<string, unknown> = {}): Promise<string> {
  const key = mediaKey("tts", VOICE_MODEL(), VOICE_ID(), text);
  const { id } = await cachedMedia(key, "audio/mpeg", { kind: "voice", text, ...meta }, () => speak(text));
  return id;
}

/** Text → MP3 bytes via ElevenLabs. One short clip per walk tick. */
export async function speak(text: string): Promise<Buffer> {
  client ??= new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  const stream = await client.textToSpeech.convert(
    VOICE_ID(),
    {
      text,
      modelId: VOICE_MODEL(),
      // 64 kbps mono is plenty for earbuds and keeps each tick's download small on mobile data
      outputFormat: "mp3_44100_64",
      applyTextNormalization: "on", // "1/125s" and "f/8" should be read as words
    },
  );
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
