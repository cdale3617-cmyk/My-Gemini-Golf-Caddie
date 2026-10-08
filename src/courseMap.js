const SUPPORTED = new Set([
  "hole", "green", "tee", "fairway",
  "bunker", "water_hazard", "pin"
]);

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

const cache = new Map();

export function osmCourseQuery(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < -90 || a > 90 ||
    b < -180 || b > 180
  ) {
    throw new Error("Invalid coordinates");
  }

  return `[out:json][timeout:45];(nwr(around:2200,${a},${b})["golf"];);out geom;`;
}

export async function fetchCourseFeatures(
  query,
  fetchImpl = fetch
) {
  if (!query || typeof query !== "string") {
    throw new Error("Invalid map query");
  }

  const saved = cache.get(query);

  if (saved && Date.now() - saved.time < 300000) {
    return saved.elements;
  }

  let lastError;

  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      35000
    );

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json"
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          "Map HTTP " + response.status
        );
      }

      const data = await response.json();

      if (!Array.isArray(data.elements)) {
        throw new Error("Invalid map response");
      }

      if (data.remark) {
        throw new Error(String(data.remark));
      }

      const elements = data.elements.filter(
        f => SUPPORTED.has(f.tags?.golf)
      );

      cache.set(query, {
        time: Date.now(),
        elements
      });

      return elements;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    "Map service unavailable: " +
    (lastError?.message || "unknown error")
  );
}

function getPoints(feature) {
  if (Array.isArray(feature?.geometry)) {
    return feature.geometry.filter(
      p =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon)
    );
  }

  if (
    Number.isFinite(feature?.lat) &&
    Number.isFinite(feature?.lon)
  ) {
    return [{
      lat: feature.lat,
      lon: feature.lon
    }];
  }

  return [];
}

function getCentre(feature) {
  const points = getPoints(feature);

  if (!points.length) return null;

  const sum = points.reduce(
    (a, p) => ({
      lat: a.lat + p.lat,
      lon: a.lon + p.lon
    }),
    { lat: 0, lon: 0 }
  );

  return {
    lat: sum.lat / points.length,
    lon: sum.lon / points.length
  };
}

function distanceMetres(a, b) {
  const dy = (a.lat - b.lat) * 111195;
  const dx =
    (a.lon - b.lon) *
    111195 *
    Math.cos(a.lat * Math.PI / 180);

  return Math.hypot(dx, dy);
}

function distanceToSegment(p, a, b) {
  const cos = Math.cos(p.lat * Math.PI / 180);

  const ax = a.lon * cos;
  const bx = b.lon * cos;
  const px = p.lon * cos;

  const vx = bx - ax;
  const vy = b.lat - a.lat;
  const len = vx * vx + vy * vy;

  const t = len
    ? Math.max(
        0,
        Math.min(
          1,
          ((px - ax) * vx +
            (p.lat - a.lat) * vy) / len
        )
      )
    : 0;

  return distanceMetres(p, {
    lat: a.lat + t * vy,
    lon: (ax + t * vx) / cos
  });
}

function distanceToHoleLine(point, hole) {
  const points = getPoints(hole);

  if (!points.length) return Infinity;

  if (points.length === 1) {
    return distanceMetres(point, points[0]);
  }

  let nearest = Infinity;

  for (let i = 1; i < points.length; i++) {
    nearest = Math.min(
      nearest,
      distanceToSegment(
        point,
        points[i - 1],
        points[i]
      )
    );
  }

  return nearest;
}

function getHoleNumber(feature) {
  const value =
    feature?.tags?.ref ??
    feature?.tags?.hole;

  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isInteger(number) &&
    number >= 1 &&
    number <= 36
      ? number
      : null;
}

function featureSizeMetres(feature) {
  const points = getPoints(feature);
  const centre = getCentre(feature);

  if (!centre || points.length < 2) {
    return 0;
  }

  return 2 * Math.max(
    ...points.map(
      p => distanceMetres(p, centre)
    )
  );
}

function assignFeatures(elements) {
  const holes = elements.filter(
    f =>
      f.tags?.golf === "hole" &&
      getHoleNumber(f) !== null
  );

  const assignments = new Map();
  const greens = new Map();

  for (const feature of elements) {
    const type = feature.tags?.golf;

    if (!SUPPORTED.has(type) || type === "hole") {
      continue;
    }

    const explicit = getHoleNumber(feature);

    if (explicit !== null) {
      assignments.set(feature, explicit);
      continue;
    }

    const centre = getCentre(feature);

    if (!centre || !holes.length) continue;

    // Prevent huge polygons covering several holes.
    if (featureSizeMetres(feature) > 250) {
      continue;
    }

    const candidates = holes.map(hole => ({
      hole,
      number: getHoleNumber(hole),
      distance: distanceToHoleLine(
        centre,
        hole
      )
    }));

    candidates.sort(
      (a, b) => a.distance - b.distance
    );

    const first = candidates[0];
    const second = candidates[1];

    if (!first || first.distance > 35) {
      continue;
    }

    if (
      second &&
      second.distance - first.distance <= 12
    ) {
      continue;
    }

    if (type === "green") {
      const line = getPoints(first.hole);
      const endpoint = line[line.length - 1];

      if (!endpoint) continue;

      const endDistance = distanceMetres(
        centre,
        endpoint
      );

      // A green must be near the end of its hole.
      if (endDistance > 45) continue;

      const previous = greens.get(first.number);

      if (
        !previous ||
        endDistance < previous.distance
      ) {
        greens.set(first.number, {
          feature
