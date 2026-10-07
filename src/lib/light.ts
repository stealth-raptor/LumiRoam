import { getPosition, getTimes } from "suncalc";
import { angleDiff, bearing, compass, distanceM, norm360, offset } from "./geo";
import type { Candidate, CommonsPhoto, LatLon, Light, ShotGeometry, Weather } from "./types";

/** Sun position and the day's light windows at a place, formatted in local time. */
export function lightAt(p: LatLon, utc: Date, utcOffsetSeconds: number): Light {
  // suncalc 2.x returns degrees, azimuth clockwise from north (1.x was radians from south)
  const pos = getPosition(utc, p.lat, p.lon);
  const alt = pos.altitude;
  const az = norm360(pos.azimuth);
  const t = getTimes(utc, p.lat, p.lon, 0, utcOffsetSeconds / 60);
  const local = (d: Date | null) =>
    d ? new Date(d.getTime() + utcOffsetSeconds * 1000).toISOString().slice(11, 16) : null;

  const phase: Light["phase"] =
    alt < -6 ? "night" : alt < -4 ? "blue hour" : alt < 6 ? "golden hour" : alt < 20 ? "low sun" : "high sun";

  return {
    phase,
    sunAltitude: Math.round(alt * 10) / 10,
    sunAzimuth: Math.round(az),
    sunCompass: compass(az),
    sunrise: local(t.sunrise),
    sunset: local(t.sunset),
    goldenStart: local(t.goldenHour),
    blueEnd: local(t.dusk),
  };
}

// rough size of each kind of subject when OSM has no height, in metres
const DEFAULT_SIZE: Record<Candidate["kind"], { h: number; w: number }> = {
  tower: { h: 45, w: 15 },
  church: { h: 30, w: 40 },
  bridge: { h: 25, w: 180 },
  building: { h: 18, w: 50 },
  monument: { h: 8, w: 5 },
  nature: { h: 20, w: 80 },
  viewpoint: { h: 0, w: 0 },
  other: { h: 10, w: 20 },
};

/**
 * Where to stand, which way to face, rough focal length and exposure.
 * Everything here is plain geometry so the language model only has to explain it, not invent it.
 */
export function shotGeometry(
  c: Candidate,
  photo: CommonsPhoto | null,
  light: Light,
  weather: Weather,
): ShotGeometry {
  const sunUp = light.sunAltitude > 0;
  const overcast = (weather.cloudCover ?? 0) >= 85;
  const size = DEFAULT_SIZE[c.kind];
  const height = c.heightM ?? size.h;

  let stand: LatLon;
  let facing: number;
  let standSource: ShotGeometry["standSource"];

  if (c.kind === "viewpoint") {
    stand = c.subject;
    standSource = "viewpoint";
    // at sunset/sunrise face into the light for silhouettes, otherwise keep the sun behind you
    facing =
      c.direction ??
      (light.phase === "golden hour" && sunUp ? light.sunAzimuth : norm360(light.sunAzimuth + 180));
  } else if (photo?.camera && distanceM(photo.camera, c.subject) >= 25 && distanceM(photo.camera, c.subject) <= 400) {
    // someone already found a spot with a clear view; the sketch is drawn from the same photo
    stand = photo.camera;
    standSource = "commons-camera";
    facing = bearing(stand, c.subject);
  } else {
    // stand with the sun over one shoulder (45° off) for front-side light and some texture
    const dist = Math.max(40, Math.min(300, Math.max(height * 2.2, size.w * 0.8)));
    const from = sunUp && !overcast ? norm360(light.sunAzimuth + 45) : 180;
    stand = offset(c.subject, from, dist);
    standSource = "computed";
    facing = bearing(stand, c.subject);
  }

  const standDistanceM = Math.round(distanceM(stand, c.subject));
  const off = angleDiff(facing, light.sunAzimuth); // 0 = looking straight into the sun
  const lightAngle: ShotGeometry["lightAngle"] =
    !sunUp || overcast ? "no direct sun" : off > 120 ? "front-lit" : off > 60 ? "side-lit" : "back-lit";

  // longest focal length that still fits the subject's height (24 mm frame side) and width
  // (36 mm side) with some breathing room, in a landscape-orientation full-frame shot
  let focalFF: number | null = null;
  if (c.kind !== "viewpoint" && standDistanceM > 0) {
    const fitV = (24 * standDistanceM) / (height * 1.4);
    const fitH = (36 * standDistanceM) / (size.w * 1.2);
    focalFF = Math.max(14, Math.min(400, Math.round(Math.min(fitV, fitH))));
  }

  return {
    stand,
    facing: Math.round(facing),
    facingCompass: compass(facing),
    standDistanceM,
    standSource,
    lightAngle,
    focalFF,
    settings: exposure(light, weather, c.kind, focalFF),
  };
}

/** Sunny-16-style EV estimate, then aperture → shutter → ISO with a handheld limit. */
function exposure(light: Light, weather: Weather, kind: Candidate["kind"], focalFF: number | null) {
  const cloud = weather.cloudCover ?? 30;
  const cloudStops = cloud < 20 ? 0 : cloud < 50 ? 0.7 : cloud < 85 ? 1.5 : 2.5;
  const base: Record<Light["phase"], number> = {
    "high sun": 15,
    "low sun": 13.5,
    "golden hour": 12,
    "blue hour": 7,
    night: 4.5,
  };
  // the light near the horizon is already dimmed by atmosphere; cloud matters less after sunset
  const ev100 = base[light.phase] - (light.phase === "night" || light.phase === "blue hour" ? cloudStops / 3 : cloudStops);

  // f/8 keeps buildings and landscapes sharp front to back; f/5.6 buys a stop for small subjects
  const N = kind === "monument" ? 5.6 : 8;
  // reciprocal rule on the full-frame-equivalent focal length, doubled to allow for no IS
  const handheld = 1 / (2 * (focalFF ?? 35));

  let iso = 100;
  let t = (N * N) / 2 ** ev100;
  while (t > handheld && iso < 3200) {
    iso *= 2;
    t /= 2;
  }
  const tripod = t > handheld;
  if (tripod) {
    // on a tripod there's no need for high ISO
    t = (N * N) / 2 ** ev100;
    iso = 100;
  }
  return { aperture: `f/${N}`, shutter: formatShutter(t), iso, tripod };
}

function formatShutter(t: number): string {
  if (t >= 1) return `${Math.round(t)}s`;
  const stops = [4000, 2000, 1000, 500, 250, 125, 60, 30, 15, 8, 4, 2];
  const denom = stops.reduce((best, s) => (Math.abs(1 / s - t) < Math.abs(1 / best - t) ? s : best));
  return `1/${denom}s`;
}
