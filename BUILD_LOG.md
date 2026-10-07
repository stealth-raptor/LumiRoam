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

- **suncalc 2.x changed units.** I wrote the sun code assuming 1.x (radians, azimuth from south). Version 2 returns degrees, with azimuth from north. The first test said the sun was at -106° altitude, which can't happen. `@types/suncalc` still describes 1.x, so TypeScript didn't catch it. Fixed by reading the package's own README and removing the stale types.
- **Naive keyword matching:** "Tower Hotel" became a *tower* and "Bridge Theatre" a *bridge*. Fixed by classifying on the head noun of the name (the last word, or the word before "of").
- **Public Overpass servers went down at about 1:40am.** All three instances returned 504 or 500, and overpass-api.de said "the server is probably too busy". A heavy query with negative-regex filters also timed out on its own, so I moved those filters into our code. Now: spots get cached in MongoDB, and if Overpass is down, ranking falls back to Wikipedia only.
- **Overpass results were silently capped at 200**, which dropped the Tower of London's own OSM record. Plaques and boundary stones had filled the list.
- **Wikimedia Commons answered 429 (too many requests)** after about a dozen calls. Fixed with one request per spot (`generator=geosearch` returns image info and camera position together), lead images batched through enwiki, a polite serial queue, and Retry-After backoff.
- **Next.js 16 cache components:** `export const dynamic` is now a build error, and `Date.now()` in a client component breaks prerendering. MongoDB reads go inside `<Suspense>` after `await connection()`.
- **Python heredocs turned `` into a real backspace** in two regexes. Regex edits now go through the editor, not shell scripts.
- **Computed stand points can land in the river.** Tower Bridge's computed position is in the Thames. Positions taken from Commons photos are always reachable, because someone actually stood there. Still open.

## What surprised me

- The laptop (i7-1250U, Intel Iris Xe, 16 GB RAM) has no CUDA GPU, so neither Gemma nor the image model can realistically run locally. Everything model-side has to live on the GPU Droplet from day one.
- Of the four sponsors whose APIs we call, only ElevenLabs lists an Agent Skill on the Hacktoberfest event. Mastra (`mastra-ai/skills`) and MongoDB (`mongodb/agent-skills`) publish official skills on GitHub. DigitalOcean has no official one, only third-party repos.
- On DigitalOcean, a powered-off Droplet is still billed. To stop GPU charges you have to snapshot it and destroy it, then recreate it from the snapshot.
- SDXL-Turbo's weights are open, but its licence is Stability's non-commercial community licence, not an OSI open-source one. That's fine for a hackathon, but worth being honest about in the post.

## Decisions

- Mastra **workflow** (locate → find-spots → write-plans → sketch → save) for planning, rather than letting a small model choose tools. Gemma does the writing inside the workflow; the walk-guide agent also has tools (nearby place, planned shot) for open questions in Mastra Studio.
- Gemma is reached through Mastra's OpenAI-compatible model config (`{ providerId, modelId, url, apiKey }`), so swapping models is just an env var.

- Project folder: moved to `C:\dev\lumiroam`, out of OneDrive, so the sync doesn't fight `node_modules`. Git branch `main`, `.env` gitignored.
- Installed official sponsor Agent Skills with `npx skills add`: ElevenLabs (10 skills, listed on the Hacktoberfest event), Mastra (`mastra-ai/skills`, 2) and MongoDB (`mongodb/agent-skills`, 8). They land in `.agents/skills` and are symlinked into `.claude/skills`.
