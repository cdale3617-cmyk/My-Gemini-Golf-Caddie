const TYPES = new Set([
  "hole", "green", "tee", "fairway",
  "bunker", "water_hazard", "pin"
]);

const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

const cache = new Map();

export function osmCourseQuery(lat, lon) {
  const a = Number(lat), b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) ||
      a < -90 || a > 90 || b < -180 || b > 180)
    throw Error("Invalid coordinates");
  return `[out:json][timeout:45];(nwr(around:2200,${a},${b})["golf"];);out geom;`;
}

export async function fetchCourseFeatures(query, fetchImpl = fetch) {
  if (typeof query !== "string" || !query.trim())
    throw Error("Invalid query");
  const old = cache.get(query);
  if (old && Date.now() - old.time < 300000)
    return old.elements;

  let error;
  for (const url of SERVERS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
      });
      if (!response.ok) throw Error("HTTP " + response.status);
      const data = await response.json();
      if (!Array.isArray(data.elements))
        throw Error("Invalid map response");
      if (data.remark) throw Error(String(data.remark));
      const elements = data.elements.filter(
        x => TYPES.has(x.tags?.golf)
      );
      cache.set(query, { time: Date.now(), elements });
      return elements;
    } catch (e) {
      error = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw Error("Map unavailable: " + (error?.message || "unknown"));
}

function points(f) {
  if (Array.isArray(f?.geometry))
    return f.geometry.filter(
      p => Number.isFinite(p.lat) && Number.isFinite(p.lon)
    );
  if (Number.isFinite(f?.lat) && Number.isFinite(f?.lon))
    return [{ lat: f.lat, lon: f.lon }];
  return [];
}

function centre(f) {
