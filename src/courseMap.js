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
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) ||
      a < -90 || a > 90 || b < -180 || b > 180) {
    throw Error("Invalid coordinates");
  }
  return `[out:json][timeout:45];(nwr(around:2200,${a},${b})["golf"];);out geom;`;
}

export async function fetchCourseFeatures(query, fetchImpl = fetch) {
  if (typeof query !== "string" || !query.trim()) {
    throw Error("Invalid query");
  }
  const saved = cache.get(query);
  if (saved && Date.now() - saved.time < 300000) {
    return saved.elements;
  }
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
      if (!response.ok) {
        throw Error("HTTP " + response.status);
      }
      const data = await response.json();
      if (!Array.isArray(data.elements) || data.remark) {
        throw Error(data.remark || "Invalid map response");
      }
      const elements = data.elements.filter(
        f => TYPES.has(f.tags?.golf)
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

function pts(f) {
  if (Array.isArray(f?.geometry)) {
    return f.geometry.filter(
      p => Number.isFinite(p.lat) && Number.isFinite(p.lon)
    );
  }
  return Number.isFinite(f?.lat) && Number.isFinite(f?.lon)
    ? [{ lat: f.lat, lon: f.lon }]
    : [];
}

function centre(f) {
  const p = pts(f);
  if (!p.length) return null;
  return {
    lat: p.reduce((s, x) => s + x.lat, 0) / p.length,
    lon: p.reduce((s, x) => s + x.lon, 0) / p.length
  };
}

function metres(a, b) {
  return Math.hypot(
    (a.lat - b.lat) * 111195,
    (a.lon - b.lon) * 111195 *
      Math.cos(a.lat * Math.PI / 180)
  );
}

function lineDistance(p, f) {
  const a = pts(f);
  if (!a.length) return Infinity;
  if (a.length === 1) return metres(p, a[0]);

  let best = Infinity;
  const c = Math.cos(p.lat * Math.PI / 180);

  for (let i = 1; i < a.length; i++) {
    const x = (a[i].lon - a[i - 1].lon) * c;
    const y = a[i].lat - a[i - 1].lat;
    const d = x * x + y * y;
    const t = d
      ? Math.max(0, Math.min(1,
          (((p.lon - a[i - 1].lon) * c) * x +
           (p.lat - a[i - 1].lat) * y) / d))
      : 0;

    best = Math.min(best, metres(p, {
      lat: a[i - 1].lat + t * y,
      lon: a[i - 1].lon +
        t * (a[i].lon - a[i - 1].lon)
    }));
  }
  return best;
}

function number(f) {
  const v = f?.tags?.ref ?? f?.tags?.hole;
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 36
    ? n
    : null;
}

function assignments(elements) {
  const holes = elements.filter(
    f => f.tags?.golf === "hole" && number(f) !== null
  );
  const result = new Map();
  const greens = new Map();

  for (const f of elements) {
    const type = f.tags?.golf;
    if (!TYPES.has(type) || type === "hole") continue;

    const n = number(f);
    if (n !== null) {
      result.set(f, n);
      continue;
    }

    const p = centre(f);
    if (!p || !holes.length) continue;

    const geometry = pts(f);
    if (geometry.length > 1 &&
        Math.max(...geometry.map(x => metres(x, p))) * 2 > 250) {
      continue;
    }

    const near = holes.map(h => ({
      hole: h,
      n: number(h),
      d: lineDistance(p, h)
    })).sort((a, b) => a.d - b.d);

    const first = near[0];
    const second = near[1];

    if (!first || first.d > 35) continue;
    if (second && second.d - first.d <= 12) continue;

    if (type === "green") {
      const path = pts(first.hole);
      const end = path[path.length - 1];
      if (!end) continue;

      const d = metres(p, end);
      if (d > 45) continue;

      const old = greens.get(first.n);
      if (!old || d < old.d) {
        greens.set(first.n, { f, d });
      }
    } else {
      result.set(f, first.n);
    }
  }

  for (const [n, value] of greens) {
    result.set(value.f, n);
  }

  return result;
}

export function featuresForHole(elements, holeNumber) {
  if (!Array.isArray(elements)) return [];
  const selected = Number(holeNumber);
  const assigned = assignments(elements);

  return elements.filter(f =>
    TYPES.has(f.tags?.golf) &&
    (f.tags.golf === "hole"
      ? number(f) === selected
      : assigned.get(f) === selected)
  );
}

export function greenPinsByHole(elements) {
  const result = {};
  if (!Array.isArray(elements)) return result;

  const assigned = assignments(elements);

  for (const f of elements) {
    if (f.tags?.golf !== "green") continue;
    const n = assigned.get(f);
    const p = centre(f);

    if (n && p && !result[n]) {
      result[n] = {
        latitude: p.lat,
        longitude: p.lon
      };
    }
  }
  return result;
}

export function projectHoleFeatures(
  elements,
  width = 320,
  height = 250
) {
  const shapes = (Array.isArray(elements) ? elements : [])
    .filter(f => TYPES.has(f.tags?.golf))
    .map(f => ({
      id: String(f.type || "feature") + ":" + String(f.id),
      type: f.tags.golf,
      coords: pts(f)
    }))
    .filter(s => s.coords.length);

  if (!shapes.length) return { shapes: [] };

  const all = shapes.flatMap(s => s.coords);
  const avg = all.reduce((s, p) => s + p.lat, 0) / all.length;
  const c = Math.cos(avg * Math.PI / 180);

  const xs = all.map(p => p.lon * c);
  const ys = all.map(p => p.lat);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const scale = Math.min(
    Math.max(1, width - 24) / Math.max(1e-8, maxX - minX),
    Math.max(1, height - 24) / Math.max(1e-8, maxY - minY)
  );

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  return {
    shapes: shapes.map(s => {
      const first = s.coords[0];
      const last = s.coords[s.coords.length - 1];

      return {
        id: s.id,
        type: s.type,
        closed:
          s.coords.length > 2 &&
          Math.abs(first.lat - last.lat) < 1e-7 &&
          Math.abs(first.lon - last.lon) < 1e-7,
        points: s.coords.map(p => ({
          x: Math.max(
            0,
            Math.min(
              width,
              width / 2 + (p.lon * c - midX) * scale
            )
          ),
          y: Math.max(
            0,
            Math.min(
              height,
              height / 2 - (p.lat - midY) * scale
            )
          )
        }))
      };
    })
  };
}
