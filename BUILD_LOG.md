# LumiRoam build log

Running notes for the DEV write-up. Newest at the bottom of each section.

## What worked

- **Ranking by Wikipedia page views** (`prop=pageviews`): famous places are usually the photogenic ones. That one signal took the top picks from "Traitor's Gate, Holy Trinity Priory, a postern" to "London Bridge, HMS Belfast, the Monument, Tower Bridge, City Hall".
- **Commons camera positions:** many geotagged photos record where the photographer stood, so "where to stand" can be a place a real person shot from. The sketch is drawn from that same photo, so the stand point and the sketch agree.
- **Gemma explains, it doesn't invent.** Sun position, stand point, focal length (from subject size and distance, converted for the user's APS-C body and actual lenses) and exposure (sunny-16, adjusted for light phase and cloud) are all computed. Gemma only gets a fact sheet. When Gemma is offline the same facts become a template plan, so the app still works.
- **Plan mode works with no keys at all:** Tower Bridge, 18:00 tomorrow, gives 5 spots in about 32 s, with a map, plans and crayon-style sketches drawn from geometry.
- `npx skills add` worked non-interactively on Windows and made working symlinks for Claude Code on the first try.
- Setup check (Oct 8): Node 22.14, npm 10.9, git 2.48, Python 3.13 already installed. ngrok is installed too, which gives an HTTPS tunnel for testing phone GPS before deploying.

## What broke

- **Open-Meteo: "Daily API request limit exceeded" on Render.** The free limit is per IP, and Render's free tier shares outbound IPs, so neighbours used up our quota. It was fatal because I also used Open-Meteo for the place's *time zone*. Now the time zone comes offline from the coordinates (`@photostructure/tz-lookup`, 97 KB, DST handled with `Intl`). Weather tries Open-Meteo, then MET Norway (free, no key), is cached for an hour per ~1 km cell in MongoDB, and if all else fails the plan just says "no forecast".

- **First deploy on Render:** every plan failed with `tlsv1 alert internal error … SSL alert number 80`. That's what Atlas does to an IP that isn't on its Network Access list: it kills the TLS handshake instead of saying "not allowed". Render's free tier has no fixed outbound IP, so the fix is allowing `0.0.0.0/0` in Atlas. It also exposed two bugs of mine. The app cached the *failed* connection promise forever, so it would have kept failing even after Atlas was fixed. And a database outage took the whole plan down, because the cache lookup in the first step threw. Now the connection retries, the cache is skipped when Mongo is down, sketches inline, and the plan still shows with "Not saved: …" and a readable reason.

- **"Lodhi Garden" geocoded to a tomb.** Nominatim matched "Tomb of Sikandar Lodhi, *Lodhi Garden*, …" because the garden is part of the tomb's address, and OSM spells the park "Lodhi Gardens". The walk was centred on the garden's northern edge and pulled in Khan Market. Fix: prefer an *area* result, otherwise look up a park by that name near the match via Overpass, then keep stops inside the park's bounding box.
- **The ranking only knew English.** "Bara Gumbad", "Sheesh Gumbad" and "Tomb of Sikandar Lodi" were all classed as "other" and dropped. Added gumbad, masjid, qila, maqbara, dargah, baoli, minar, darwaza, mahal, chhatri, ghat and more. My "small stuff" filter also dropped OSM `historic=tomb`, which in Delhi means a mausoleum.
- **The park blocked its own monuments.** The garden's centre point was a stop, and nothing within 120 m of it was allowed, so the two Gumbads disappeared. Parks no longer crowd out what's inside them.
- **Overpass outages got cached for a week.** A Wikipedia-only result from an outage was cached as if complete. Now only complete results are cached.
- **Gemma 4 "thinks" before it talks.** On Cloudflare a 50-word story took ~40 s, mostly hidden reasoning. My 25 s walk timeout cut it off and quietly fell back to the raw Wikipedia intro. `chat_template_kwargs: {enable_thinking: false}` brings it to ~2 s and uses ~4× fewer neurons. Mastra's built-in OpenAI-compatible client can't add body fields, so Gemma now goes through `@ai-sdk/openai-compatible` with a small fetch wrapper (`LLM_EXTRA_BODY`).
- **Duplicate-key race in GridFS.** Two stops drew identical fallback SVGs at the same moment. The unique index did its job; the code now reuses the winner and cleans up the orphaned chunks.
- **Cloudflare FLUX rejects `seed`.** That's fine: drawings are cached by prompt in GridFS, so they stay stable anyway.

- **No more free Hugging Face credits.** The HF token came from a free account whose monthly Inference Provider credits were already gone, so every Gemma call returned `402 Payment Required`. Mastra's fallback model and the template text kept the app working, but the plans weren't written by Gemma.
- **ZeroGPU quota maths.** The official FLUX.1-schnell Space draws a lovely crayon picture in about 10 s on the HF token's free ZeroGPU allowance. But every call *reserves* 90 s of GPU, and the free daily allowance is a few minutes. After one test image, every request failed with "90s requested vs. 0s left". The page also kept firing all 20 requests after the first refusal; it now stops at the first quota error.
- **Hydration failure from a date.** The server rendered "Friday, October 9" and the phone rendered "Friday, 9 October", so React threw away the whole shoot page and nothing on it worked. There was no visible error, just dead buttons. Dates for the destination's wall-clock time are now formatted in a fixed locale and time zone; real instants in the walk diary are marked as browser-rendered.
- **A dead end, and why:** I first built on-device "photo → crayon" (Informative Drawings, a 17 MB MIT ONNX model). It ran in 2 s, but needed 563 MB of RAM in Node, too much for Render's free 512 MB, so I moved it into the browser. Then it turned out not to be what you wanted at all. You wanted *Gemma to look at the photo and describe the drawing*, with a text-to-image model drawing it. Removed.

- **suncalc 2.x changed units.** I wrote the sun code assuming 1.x (radians, azimuth from south). Version 2 returns degrees, with azimuth from north. The first test said the sun was at -106° altitude, which can't happen. `@types/suncalc` still describes 1.x, so TypeScript didn't catch it. Fixed by reading the package's own README and removing the stale types.
- **Naive keyword matching:** "Tower Hotel" became a *tower* and "Bridge Theatre" a *bridge*. Fixed by classifying on the head noun of the name (the last word, or the word before "of").
- **Public Overpass servers went down at about 1:40am.** All three instances returned 504 or 500, and overpass-api.de said "the server is probably too busy". A heavy query with negative-regex filters also timed out on its own, so I moved those filters into our code. Now: spots get cached in MongoDB, and if Overpass is down, ranking falls back to Wikipedia only.
- **Overpass results were silently capped at 200**, which dropped the Tower of London's own OSM record. Plaques and boundary stones had filled the list.
- **Wikimedia Commons answered 429 (too many requests)** after about a dozen calls. Fixed with one request per spot (`generator=geosearch` returns image info and camera position together), lead images batched through enwiki, a polite serial queue, and Retry-After backoff.
- **Next.js 16 cache components:** `export const dynamic` is now a build error, and `Date.now()` in a client component breaks prerendering. MongoDB reads go inside `<Suspense>` after `await connection()`.
- **Python heredocs turned `` into a real backspace** in two regexes. Regex edits now go through the editor, not shell scripts.
- **Computed stand points can land in the river.** Tower Bridge's computed position is in the Thames. Positions taken from Commons photos are always reachable, because someone actually stood there. Still open.

## What surprised me

- **My own push slipped past my own safety check.** I ran a secret scan and `git push` joined by `;` instead of `&&`, so the push went ahead before I'd read the scan. The 2 hits turned out to be placeholder examples in the MongoDB skill docs, and nothing secret went to GitHub. Lesson: gate on the result.

- **My own Caddy config skipped its API-key check.** Caddy runs `handle` blocks before `respond`, so the `respond 401` for a missing key would never have run. That would have left Gemma open to anyone who found the URL. I caught it on re-read, before deploying. `route { }` keeps the written order.
- **Audio in a pocket:** phone browsers only let a page play sound after a tap. The Start button plays a tiny silent WAV, generated in code, to unlock audio for clips that arrive later. If there's no ElevenLabs key, the browser's built-in voice reads the text instead.

- The laptop (i7-1250U, Intel Iris Xe, 16 GB RAM) has no CUDA GPU, so neither Gemma nor the image model can realistically run locally. Everything model-side has to live on the GPU Droplet from day one.
- Of the four sponsors whose APIs we call, only ElevenLabs lists an Agent Skill on the Hacktoberfest event. Mastra (`mastra-ai/skills`) and MongoDB (`mongodb/agent-skills`) publish official skills on GitHub. DigitalOcean has no official one, only third-party repos.
- On DigitalOcean, a powered-off Droplet is still billed. To stop GPU charges you have to snapshot it and destroy it, then recreate it from the snapshot.
- SDXL-Turbo's weights are open, but its licence is Stability's non-commercial community licence, not an OSI open-source one. That's fine for a hackathon, but worth being honest about in the post.

## Decisions

- **Every stop gets a little history** (you asked for it): two or three sentences on who built it, when, and why it matters, retold by Gemma from that stop's Wikipedia text only. It's shown on the card and spoken when you arrive at the planned spot, before the settings. Without Gemma, it's the first two sentences of the article.
- **Camera is free text** ("Canon EOS 250D", "Sony A7 IV") with a plain APS-C / full-frame choice guessed from the name. The crop factor follows the brand: Canon APS-C is 1.6x, others 1.5x.
- **The lens line is no longer Gemma's to write.** It once turned "wider than your 18mm, step back 13 m" into "zoom out to 15mm" on an 18-55. Lens advice is pure maths for your own body and lenses, so the computed sentence is shown as-is.

- **A short photowalk: 4 stops, one drawing each, 800 m default radius** (options 500 m / 800 m / 1.2 km).
- **One Gemma call per plan**, with all 4 photos and fact sheets, so the drawings can differ from each other. A Lodhi Garden example is in the prompt (tomb from the bottom up, the trees, a squirrel on a trunk, the Athpula bridge), plus a per-stop drawing hint (parks: trees and wildlife; monuments: from below). Result for Lodhi Garden: "Light through leaves", "Dome from below", an upward detail of Shish Gumbad, and Sikandar Lodi's tomb as a silhouette.
- Timings now: plan ~18-28 s, each FLUX drawing ~5-25 s (lazy, one at a time), walk tick ~6-30 s, mostly Wikipedia lookups and TTS.

- **Drawings, final design (your call):** Gemma 4 (vision) gets the real Commons photo plus the computed fact sheet and, in **one call per spot**, returns the plan *and* 4 drawing prompts (Main shot, Detail, Vertical, Creative). It looks at the photo so the drawing resembles the real place. **FLUX.1 [schnell]** (Apache-2.0) draws each prompt on first view. Every drawing is cached in GridFS by prompt hash, so it's never drawn twice. While a frame waits, the free geometry SVG stands in for it.
- **Cloudflare Workers AI** came out as the zero-cost host for both halves. One free account (10k neurons a day) serves Gemma 4 26B-A4B with vision through an OpenAI-compatible endpoint, plus FLUX.1 schnell at about 40-60 neurons a drawing. Everything is still configurable: Hugging Face router, OpenRouter's free Gemma tier, or the HF ZeroGPU Space are all just env changes.

- **Dropped DigitalOcean (Oct 8, about 3am).** A GPU Droplet needs a card on file, at about $0.76/hr, and that wasn't possible for me. Gemma moved to **Hugging Face Inference Providers**: `router.huggingface.co/v1` is OpenAI-compatible, so Mastra only needed a new base URL. Gemma 4 31B runs on Novita/DeepInfra at about $0.14 in / $0.40 out per million tokens, which is roughly $0.002 per plan. The 26B-A4B MoE is a Mastra model fallback. Still open weights and swappable through env vars, but no longer on a server I control. That's a trade-off worth saying out loud in the post.
- **More MongoDB, where it earns its place:**
  - GridFS stores every generated sketch and ElevenLabs clip, keyed by a hash of what produced it (model + photo + light, or voice + text). The same sketch or sentence is never generated or paid for twice, and the walk diary can replay every clip.
  - A **time-series collection** (`walk_points`, metaField = walk, 90-day expiry) records the route walked.
  - The walk doc logs everything said, and where.
  - The `/walk/[id]` **diary** shows route, distance, stories heard and planned shots reached. It's built for the "taking it outside" section.
  - Already in place: 2dsphere `$geoNear` for "shot nearby" and "unheard place nearby", plus a TTL cache for Overpass, Nominatim and Commons results.
- Sketches default to the free geometry drawing. `SKETCH_MODE=hf` uses **Qwen-Image-Edit** (Apache-2.0) through HF providers. It's an instruction-based editor ("redraw as a crayon drawing, keep the layout"), with a cleaner licence than SDXL-Turbo, but it costs money per image.

- Walk mode keeps per-walk state in MongoDB: places already heard, shots already talked through, and the last "your shot is N m away" note. That way it only speaks again when you're meaningfully closer, and never repeats a story. Both "what's here" and "is my shot near" are `$geoNear` queries on 2dsphere indexes.
- Walk-mode Wikipedia places are cached per roughly 500 m grid cell for a day, so a one-hour walk doesn't hit Wikipedia on every tick.
- GPU bundle (`gpu/`): Ollama runs Gemma bound to localhost, a FastAPI SDXL-Turbo img2img server, and Caddy provides HTTPS (via sslip.io) and the bearer key. Snapshot and destroy to stop billing.

- Mastra **workflow** (locate → find-spots → write-plans → sketch → save) for planning, rather than letting a small model choose tools. Gemma does the writing inside the workflow; the walk-guide agent also has tools (nearby place, planned shot) for open questions in Mastra Studio.
- Gemma is reached through Mastra's OpenAI-compatible model config (`{ providerId, modelId, url, apiKey }`), so swapping models is just an env var.

- Project folder: moved to `C:\dev\lumiroam`, out of OneDrive, so the sync doesn't fight `node_modules`. Git branch `main`, `.env` gitignored.
- Installed official sponsor Agent Skills with `npx skills add`: ElevenLabs (10 skills, listed on the Hacktoberfest event), Mastra (`mastra-ai/skills`, 2) and MongoDB (`mongodb/agent-skills`, 8). They land in `.agents/skills` and are symlinked into `.claude/skills`.
