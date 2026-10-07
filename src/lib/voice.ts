import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export const voiceConfigured = () => !!process.env.ELEVENLABS_API_KEY;

let client: ElevenLabsClient | null = null;

/** Text → MP3 bytes via ElevenLabs. One short clip per walk tick. */
export async function speak(text: string): Promise<Buffer> {
  client ??= new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  const stream = await client.textToSpeech.convert(
    process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb", // George: calm, narrative
    {
      text,
      modelId: process.env.ELEVENLABS_MODEL || "eleven_v4",
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
