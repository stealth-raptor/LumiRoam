# LumiRoam: what happens behind the screen

*A script to read aloud. Lines in [brackets] are optional cues for what to show on screen. It follows one
real request from start to finish: first planning a walk, then walking it. Reading time is about 15
minutes; the "Short version" at the end is a 1-minute cut.*

---

## 0. The idea in one breath

Most AI tour guides tell you about a building. LumiRoam tells you how and when to photograph it.
You plan on your phone for a minute, then the phone goes in your pocket and the guide talks to you
while you walk. Everything that makes it work is open: Gemma for the language, FLUX for the drawings,
OpenStreetMap and Wikipedia for the facts, Mastra to tie it together. MongoDB Atlas remembers it all.

---

## Part one: planning a walk

### 1. You fill in the form

[Show the plan form]

I type where I'm going, for example "Lodhi Garden, New Delhi", and the time I'll be there, in that
place's local time. I type my camera, say "Canon EOS 250D". As I type, the app guesses the sensor: a
250D is APS-C, a Sony A7 IV would switch it to full frame. I can override it. Then my lenses, like
"18-55 kit, 50mm f/1.8", and how big the walk should be. The default is 800 metres, because this is
a photowalk, not a city tour. The phone remembers my camera and lenses for next time, on the phone
only.

When I tap "Plan my shoot", the phone sends one request to the server. The server checks it against
a schema first, so a bad date or an empty place name never gets further.

### 2. Mastra takes over: a workflow, not a free-roaming agent

[Show the workflow in Mastra Studio, or the five step names]

The server hands the request to a Mastra **workflow** called plan-shoot. It has five steps that always
run in the same order: **locate, find spots, write plans, fallback sketch, save.**

I chose a workflow on purpose. A smaller open model, left to decide by itself which tools to call and
when, is unreliable. Here the order is fixed, the maths is done by ordinary code, and Gemma does what
language models are good at: looking, describing and explaining.

### 3. Step one, locate: where is this place, and what time is it there?

**Finding the place.** The place name goes to Nominatim, OpenStreetMap's free geocoder. Nominatim
asks for at most one request a second, so every call to it goes through a little queue that waits
1.1 seconds between requests, and every request carries a User-Agent naming LumiRoam and its GitHub
repo, because these free services throttle anonymous traffic.

There's a trap here that I hit for real. "Lodhi Garden" doesn't come back as the garden. It comes back
as a *tomb inside* the garden, because "Lodhi Garden" is part of the tomb's address, and the park
itself is mapped as "Lodhi Gardens", with an s. So the app asks for ten results and prefers one that
is an *area*, like a park or a square. If none of them is, it asks OpenStreetMap's Overpass API for a
park or garden with that name nearby, and uses its outline. The result is a centre point and a
bounding box: the edges of the garden.

The answer is cached in MongoDB for 30 days, so the next person who plans Lodhi Garden doesn't
touch Nominatim at all.

**Working out the time.** I typed "17:30", but the sun doesn't care about wall clocks. It needs an
exact moment in UTC, and that needs the place's time zone. The time zone is looked up **offline**,
straight from the coordinates, with a 97-kilobyte library. Lodhi Garden is Asia/Kolkata. Then the
JavaScript Intl API works out the offset in force on that date, plus five and a half hours here,
including summer time in places that have it. So 17:30 in Delhi becomes 12:00 UTC.

Why offline? Because I used to get the time zone from the weather API, and when that API ran out of
free requests, planning broke completely. Now the sun maths depends on nothing external.

**The weather.** The app needs cloud cover, low cloud, chance of rain and visibility for that hour.
First it checks MongoDB for a forecast it already fetched for the same spot, give or take a
kilometre, and the same hour. If there is one younger than an hour, it uses that. If not, it asks
**Open-Meteo**. Open-Meteo's free limit is counted per IP address, and on a shared host like
Render's free tier, other apps can use it up. So if Open-Meteo refuses, the app asks **MET Norway**,
the Norwegian weather service, which is free, global and needs no key. A good answer is stored for an
hour; a "no forecast" is deliberately *not* stored, so the next request tries again. If both
services fail, the plan carries on and simply says "no forecast available".

### 4. Step two, find spots: what's worth photographing here?

[Show the map with the four stops]

**What's there.** The app asks the Overpass API for named things within 800 metres: viewpoints,
historic sites, towers, bridges, lighthouses, places of worship, peaks, waterfalls and notable parks.
Public Overpass servers are often busy, so it tries three of them in turn. It throws away the small
stuff that clutters a city, like plaques, boundary stones and milestones. That filtering happens in
our code rather than in the query, because a "fancy" query timed the main server out.

**What's notable.** At the same time it asks **Wikipedia** for articles with coordinates nearby. If an
OpenStreetMap object and a Wikipedia article have the same name and sit within 400 metres of each
other, they're merged into one place. Articles about events, like a bombing or a festival, are
dropped. Then it fetches the opening paragraph of every article, 20 at a time in a single request,
together with **how many people read that article in the last 30 days.**

**What kind of thing is it?** A tower, a bridge, a monument, a garden? OpenStreetMap tags are trusted
first. If there are none, the app looks at the main noun of the name: the last word, or the word
before "of". So "Tower Hotel" is not a tower, but "Tomb of Sikandar Lodi" is a tomb. The word list
includes South Asian words too: gumbad, masjid, qila, maqbara, baoli, minar. Without them, Bara
Gumbad and Shish Gumbad were being thrown away.

**Ranking.** Every place gets a score: what kind of thing it is, a bonus if it really exists on the map,
a bonus if it's a whole building outline rather than a point, a bonus for having a Wikipedia article,
and a popularity bonus from those page views. Famous places tend to be the photogenic ones. A small
penalty applies for distance.

**Keeping the walk small.** If the place I typed is an area that fits inside the walk, only stops inside
its outline are kept, so a Lodhi Garden walk stays in Lodhi Garden. Stops must be at least 60 metres
apart, except that the garden itself never blocks the monuments standing inside it.

This whole candidate list is cached in MongoDB for a week, but **only if Overpass actually answered.**
A half-result from an outage isn't remembered.

**A real photo for every stop.** For each candidate, the app looks for a photo on **Wikimedia Commons.**
Two sources are checked:

- The Wikipedia article's lead image, fetched for all candidates at once through Wikipedia's
  API. It's only accepted if the file actually lives on Commons, which means it's freely licensed.
- Geotagged Commons photos taken within 300 metres, in one combined request that returns the
  file, its licence, its photographer, and **where the camera stood.**

A nearby photo only counts if its title names the place, and interiors, signs, plaques and maps are
skipped. The best photo is one whose camera stood 30 to 300 metres away. That gives me a proven place
to stand: a real person stood there and took that picture. Places nobody has photographed and
uploaded are usually not very photogenic, so they're used only if there aren't enough others.
Wikimedia rate-limits hard, so these requests go out one at a time with a short gap, back off and
retry when told to slow down, and every photo choice is cached for a week.

The first four good stops make the walk.

### 5. The light: where will the sun be?

[Show a stop card's light line: "golden hour, sun 5.5° west"]

For each stop, the **suncalc** library takes the coordinates and that exact UTC moment, and returns the
sun's height above the horizon and its compass direction. It also gives the day's sunrise, sunset,
start of golden hour and end of blue hour, which are converted back to local time.

From the sun's height, the app names the light:

- below minus 6 degrees is **night**
- minus 6 to minus 4 is **blue hour**
- minus 4 to plus 6 is **golden hour**
- up to 20 degrees is **low sun**
- above that is **high sun**

### 6. The geometry: where to stand, which way to face, which lens

**Where to stand** comes from one of three places, in this order:

1. If the stop is a viewpoint, you stand at the viewpoint, facing the direction it's mapped as looking
   out to. Otherwise you face the sunset in golden hour, or keep the sun behind you.
2. If the Commons photo knows where its camera was, you stand there, facing the subject.
3. Otherwise the app computes a spot, 45 degrees off the sun so the light comes over your shoulder, at a
   distance that fits the size of the subject: further back for a long bridge, closer for a statue.

From your facing direction and the sun's direction, it knows whether the subject will be **front-lit,
side-lit or back-lit**, or that there's no direct sun at all.

**Which lens.** Knowing roughly how tall and how wide the subject is and how far away you are, the app
works out the longest focal length that still fits it in the frame with a bit of room, in full-frame
terms. Then it converts that to *your* camera: divide by 1.6 for Canon APS-C, 1.5 for other APS-C, 1 for
full frame. Then it checks *your* lenses. If your 18-55 covers it, it says so. If the shot needs wider
than 18mm, it tells you how many metres to step back. If it needs longer than you have, how far to walk
closer.

This lens sentence is pure maths, and it's always shown exactly as computed. I learned that the hard
way, when Gemma once "improved" it to 15mm on a lens that only goes to 18.

**Starting settings.** This is the old sunny-16 rule, as code. The light phase gives a base brightness:
15 in high sun, 13.5 in low sun, 12 in golden hour, 7 in blue hour, about 4.5 at night. Cloud takes
some off. The aperture is f/8, or f/5.6 for smaller monuments. The shutter speed follows from those.
If it's too slow to hold steady, which is roughly one over twice the focal length, the ISO doubles
until it is, up to 3200. If even that isn't enough, it tells you to use a tripod or a wall, and puts
ISO back to 100. It's a starting point; check the histogram after the first frame.

### 7. Step three, write plans: Gemma looks at the photos

[Show a full stop card: headline, history box, stand, lens, settings, tip]

Now the open model comes in. For each stop the app builds a **fact sheet**:

- the light and the sun times
- the weather
- the computed stand point, lens and settings
- my camera and lenses
- the Wikipedia text
- a drawing hint: for a park, draw its trees and wildlife up close; for a monument, try it from below

Each stop's Commons photo is downloaded at 512 pixels and attached as an image.

All four stops go to **Gemma 4** in **one single call**, photos and fact sheets together. Gemma runs on
Cloudflare Workers AI's free tier, through the same OpenAI-compatible API that self-hosted servers
use. One call for the whole walk means Gemma can see all four places at once and make the drawings
different from each other. It also uses less of the free daily allowance.

Two details made this work in practice:

- Gemma 4 normally "thinks" before it answers. That took up to 40 seconds and four times the
  credits, so every request switches thinking off. Answers come back in about two seconds.
- The free host doesn't support a native JSON mode, so Mastra writes the required JSON schema into the
  prompt itself, and checks the answer against it.

For each stop Gemma returns:

- a headline
- where to stand, in friendly words
- the settings with a one-line reason
- a composition tip
- a **short history of the place, retold only from the Wikipedia text**, so it can't invent dates or
  names
- a label and a prompt for **one drawing**

In the prompt there's a worked example: a walk in Lodhi Garden would draw Mohammed Shah's tomb from
the bottom of its steps, the old trees in the wooded part, a squirrel on a trunk, and the Athpula
bridge.

If the Gemma 4 model is down, Mastra automatically falls back to Gemma 3. If Gemma isn't reachable at
all, every field is filled from a template built from the same facts, so the app still works.

### 8. Step four, fallback sketch: a free picture straight away

The real drawings take a few seconds each, so first every stop gets an instant picture drawn by plain
code as an SVG:

- a sky in the colours of the light phase
- the sun placed where it will actually be in your frame, from where you're facing and how wide your
  lens sees, or an arrow if it's off to one side
- a simple shape for the subject: a tower, a bridge, a dome, trees
- a wobbly "crayon" filter on top

It's stored in MongoDB's **GridFS** under a fingerprint of the drawing itself, so identical pictures are
only stored once.

### 9. Step five, save

The shoot is saved to **MongoDB Atlas**. One document holds the shoot itself; each stop is its own
document, with its subject and its stand point stored as geographic points. The stand points have a
**geospatial index**, which is what makes walk mode fast later. If the database can't be reached, the
plan still appears on screen with a note saying it wasn't saved and why.

### 10. The drawings arrive

[Show the drawings appearing one by one]

The shoot page loads from MongoDB. Then the phone asks for each stop's drawing, **one at a time**:

1. The server first checks GridFS for a drawing with a fingerprint made of the provider, the model and
   the exact prompt.
2. If one exists, it comes straight back, free.
3. If not, the prompt goes to **FLUX.1 [schnell]**, an open Apache-2.0 image model, on Cloudflare
   Workers AI, in four steps. Every prompt starts with "A young child's wax crayon drawing on white
   paper…", so all the drawings share one look.
4. The picture comes back as base64. It's stored in GridFS, its link is saved on the stop, and it's
   served from our own media route with headers telling the phone it never changes, so it's cached
   there too.

If the free daily drawing allowance runs out, the server says so once and the phone stops asking,
keeping the fallback sketch.

---

## Part two: walking

### 11. Start walk

[Show the Start button, then pocket mode]

When I tap **Start walk**, three things happen inside that one tap:

1. **Audio gets unlocked.** Phone browsers only play sound after a tap, so the app plays a tenth of a
   second of silence, a WAV file it builds in code, so later clips can play with the phone in my
   pocket.
2. **The screen is kept awake** with the Wake Lock API, because phone browsers pause GPS when the
   screen locks. Pocket mode is just a black screen on top, with the screen still on.
3. The server creates a **walk** document in MongoDB: which shoot it belongs to, what I've already
   heard, which shots I've already done.

Then the phone watches GPS. It works out which way I'm heading from the GPS itself, or from my last
few metres of movement. Every 5 metres or 15 seconds it notes a breadcrumb.

### 12. A check-in: every 75 metres, or every 3 minutes

[Show the walk log, or play an audio clip]

When I've walked 75 metres, or 3 minutes have passed, the phone sends a **tick**: where I am, which way
I'm facing, and the breadcrumbs since the last tick.

**My route is recorded.** The breadcrumbs go into a MongoDB **time-series collection**, which is built
for exactly this kind of data, and expires after 90 days.

**Is my planned shot near?** MongoDB's **$geoNear** finds the nearest stand point in my shoot that I
haven't done yet, using the geospatial index:

- **Within 35 metres:** I'm there. I hear a little of the place's history, which way to face (turn
  left, turn right), my lens, my settings and the tip. That shot is marked done.
- **Within 800 metres:** I hear "Your planned shot of Bara Gumbad is about 200 metres ahead, to the
  south". It only speaks again for a different shot, or once I'm meaningfully closer: under 500, 250,
  then 100 metres. It doesn't nag.

**What's around me that I haven't heard about?** The app keeps Wikipedia places in MongoDB too:

1. The area is divided into cells about 500 metres across. The first time anyone walks into a cell,
   the app fetches the Wikipedia articles within 800 metres and stores them with their location and
   their opening text. Each cell is refreshed at most once a day.
2. Another **$geoNear** query finds the nearest place within 350 metres that I haven't heard yet on
   this walk, and marks it as heard.
3. That place's Wikipedia text goes to the **guide agent**, Gemma again, with thinking off and tools
   off. It retells the text in about 50 words, like a friend walking next to me, using only facts from
   that text, and ends with something worth photographing.
4. If Gemma is unavailable, I hear the first two sentences of the article instead.

If I've just arrived at a planned spot, there's no history story on top. One thing at a time.

**Voice.** Text written for screens reads badly aloud, so "f/8" becomes "f 8" and "1/250s" becomes "a
250th of a second". Each sentence goes to **ElevenLabs** separately, and comes back as a small MP3 suited
to earbuds. Every clip is stored in GridFS under a fingerprint of the model, the voice and the exact
words. The same sentence on another walk costs nothing. If ElevenLabs isn't available, the phone's
own built-in voice reads it instead.

Everything that was said, and where, is added to the walk's log.

### 13. Stop, and the walk diary

[Show the diary page]

When I tap **Stop**, the last breadcrumbs are saved and the walk is closed. The diary page reads it
all back from MongoDB:

- my route, from the time-series collection, drawn on the map
- the distance, adding up the gaps between breadcrumbs
- how many minutes, how many stories, and which planned shots I reached
- every clip, which I can play again

---

## The plumbing that keeps it standing

[Optional: show BUILD_LOG.md]

- **Being polite to free services.** Each free API gets its own queue: one request a second for
  Nominatim, a short gap for Wikimedia. When a service says "too many requests", the app waits as long
  as it asks, then retries.
- **One database connection, reused.** A small pool sized for one person. If it fails, the next request
  tries again, instead of failing forever.
- **Caching everywhere it pays off:**
  - places: 30 days
  - candidates and photos: a week
  - Wikipedia cells: a day
  - weather: an hour
  - drawings and voice clips: forever, under a fingerprint of what made them

  The cache expires itself through a TTL index. If two requests make the same drawing at the same
  moment, a unique index keeps one and the other reuses it.
- **Graceful fallbacks at every layer:**

  | If this fails… | …the app uses this instead |
  |---|---|
  | Gemma 4 | Gemma 3, then templates |
  | FLUX | the geometry sketch |
  | ElevenLabs | the phone's voice |
  | Open-Meteo | MET Norway, then "no forecast" |
  | Overpass | Wikipedia only, not cached |
  | the database | the plan still shows, unsaved |

- **Swappable models.** Which model, which host, even switching Gemma's thinking off, are all settings,
  not code. The same app runs on Cloudflare, Hugging Face, OpenRouter, or a server of my own.

---

## Short version (about 1 minute)

You type a place, a time and your camera. A Mastra workflow finds the place on OpenStreetMap, works out
the exact moment in UTC offline, and gets the weather from Open-Meteo or MET Norway, cached for an hour
in MongoDB. It finds what's photogenic nearby from OpenStreetMap and Wikipedia, ranks it partly by how
many people read about it, and picks four stops with real Wikimedia Commons photos, ideally ones that
know where the photographer stood. suncalc says where the sun will be; plain code works out where to
stand, which lens for your exact camera, and starting settings. Gemma 4 looks at all four photos at
once and writes the plan, a short history from Wikipedia only, and one drawing prompt per stop, which
FLUX.1 schnell draws. Then the phone goes in your pocket. Every 75 metres MongoDB's geospatial search
asks two questions: is my planned shot near, and what's here that I haven't heard about. Gemma retells
it, ElevenLabs speaks it, and every clip, drawing and step of the route is saved in Atlas for the walk
diary.
