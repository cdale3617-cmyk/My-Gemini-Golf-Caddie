const SUPPORTED = new Set(["hole", "green", "tee", "fairway", "bunker", "water_hazard", "pin"]);
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export async function fetchCourseFeatures(query, fetchImpl = fetch) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json",
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Overpass returned " + response.status);
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error("Invalid Overpass response");
      return data.elements;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("All Overpass instances failed");
}

export function osmCourseQuery(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Course coordinates are invalid.");
  return `[out:json][timeout:25];nwr(around:2200,${lat},${lon})["golf"~"^(hole|green|tee|fairway|bunker|water_hazard|pin)$"];out geom;`;
}

export function coordinatesOf(feature) {
  const geometry = Array.isArray(feature?.geometry) ? feature.geometry : [];
  const points = geometry
    .map((point) => ({ latitude: Number(point.lat), longitude: Number(point.lon) }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (points.length) return points;
  if (Number.isFinite(Number(feature?.lat)) && Number.isFinite(Number(feature?.lon))) {
    return [{ latitude: Number(feature.lat), longitude: Number(feature.lon) }];
  }
  const center = feature?.center;
  if (Number.isFinite(Number(center?.lat)) && Number.isFinite(Number(center?.lon))) {
    return [{ latitude: Number(center.lat), longitude: Number(center.lon) }];
  }
  return [];
}

export function featureCenter(feature) {
  const points = coordinatesOf(feature);
  if (!points.length) return null;
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

export function holeReference(feature) {
  const raw = feature?.tags?.ref ?? feature?.tags?.hole ?? feature?.tags?.number;
  const match = String(raw ?? "").match(/\d{1,2}/);
  return match ? Number(match[0]) : null;
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function greenPinsByHole(elements) {
  const features = Array.isArray(elements) ? elements : [];
  const holeLines = features.filter((feature) => feature?.tags?.golf === "hole" && coordinatesOf(feature).length > 1);
  const greens = features.filter((feature) => feature?.tags?.golf === "green" && coordinatesOf(feature).length);
  const pins = {};
  for (const hole of holeLines) {
    const number = holeReference(hole);
    if (!number || number < 1 || number > 18) continue;
    const line = coordinatesOf(hole);
    const end = line[line.length - 1];
    const explicitlyMatched = greens.find((green) => holeReference(green) === number);
    const nearestGreen = explicitlyMatched || greens.reduce((best, green) => {
      const candidate = featureCenter(green);
      return !best || distance(end, candidate) < best.distance ? { green, distance: distance(end, candidate) } : best;
    }, null)?.green;
    const pin = nearestGreen ? featureCenter(nearestGreen) : end;
    if (pin) pins[number] = pin;
  }
  return pins;
}

export function featuresForHole(elements, number) {
  const features = (Array.isArray(elements) ? elements : []).filter((feature) => {
    const type = feature?.tags?.golf;
    return SUPPORTED.has(type) && coordinatesOf(feature).length;
  });
  const explicitHole = features.find((feature) => feature.tags.golf === "hole" && holeReference(feature) === number);
  const explicitGreen = features.find((feature) => feature.tags.golf === "green" && holeReference(feature) === number);
  const anchor = explicitHole ? featureCenter(explicitHole) : explicitGreen ? featureCenter(explicitGreen) : null;
  if (!anchor) return [];

  const line = coordinatesOf(explicitHole || explicitGreen);
  const start = line[0] || anchor;
  const end = line[line.length - 1] || anchor;
  return features.filter((feature) => {
    const ref = holeReference(feature);
    if (ref != null) return ref === number;
    const center = featureCenter(feature);
    const nearTarget = Math.min(distance(center, anchor), distance(center, start), distance(center, end)) < 150;
    return nearTarget && feature.tags.golf !== "hole";
  });
}

export function projectHoleFeatures(elements, width = 320, height = 250) {
  const features = (Array.isArray(elements) ? elements : []).map((feature) => ({ feature, points: coordinatesOf(feature) })).filter((item) => item.points.length);
  const all = features.flatMap((item) => item.points);
  if (!all.length) return { shapes: [], width, height };
  const minLat = Math.min(...all.map((point) => point.latitude));
  const maxLat = Math.max(...all.map((point) => point.latitude));
  const minLon = Math.min(...all.map((point) => point.longitude));
  const maxLon = Math.max(...all.map((point) => point.longitude));
  const latSpan = Math.max(maxLat - minLat, 0.00012);
  const lonSpan = Math.max(maxLon - minLon, 0.00012);
  const scale = Math.min((width - 30) / lonSpan, (height - 30) / latSpan);
  const usedWidth = lonSpan * scale;
  const usedHeight = latSpan * scale;
  const left = (width - usedWidth) / 2;
  const top = (height - usedHeight) / 2;
  const mapPoint = (point) => ({
    x: left + (point.longitude - minLon) * scale,
    y: height - top - (point.latitude - minLat) * scale,
  });
  const shapes = features.map(({ feature, points }) => ({
    id: `${feature.type || "feature"}-${feature.id}`,
    type: feature.tags?.golf,
    points: points.map(mapPoint),
    closed: points.length > 2 && points[0].latitude === points[points.length - 1].latitude && points[0].longitude === points[points.length - 1].longitude,
  }));
  return { shapes, width, height };
}
