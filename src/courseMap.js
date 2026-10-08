const SUPPORTED = new Set(["hole", "green", "tee", "fairway", "bunker", "water_hazard", "pin"]);
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export async function fetchCourseFeatures(query, fetchImpl = fetch) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json",
          "User-Agent": "MyGeminiGolfCaddie/1.0 (+https://github.com/cdale3617-cmyk/My-Gemini-Golf-Caddie)",
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
  return `[out:json][timeout:45];nwr(around:2200,${lat},${lon})["golf"~"^(hole|green|tee|fairway|bunker|water_hazard|pin)$"];out geom;`;
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

function distanceToRoute(point, route) {
  if (!point || !route?.length) return Infinity;
  const origin = route[0];
  const latScale = 111132;
  const lonScale = 111320 * Math.cos((origin.latitude * Math.PI) / 180);
  const xy = (p) => ({ x: (p.longitude - origin.longitude) * lonScale, y: (p.latitude - origin.latitude) * latScale });
  const p = xy(point);
  if (route.length === 1) {
    const a = xy(route[0]);
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let closest = Infinity;
  for (let i = 1; i < route.length; i += 1) {
    const a = xy(route[i - 1]);
    const b = xy(route[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
    closest = Math.min(closest, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return closest;
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
  const selectedHole = features.find((feature) => feature.tags.golf === "hole" && holeReference(feature) === number);
  const explicitlyMatchedGreen = features.find((feature) => feature.tags.golf === "green" && holeReference(feature) === number);
  const anchorFeature = selectedHole || explicitlyMatchedGreen;
  if (!anchorFeature) return [];

  const route = coordinatesOf(anchorFeature);
  const start = route[0];
  const finish = route[route.length - 1];
  const endpointDistance = (feature) => {
    const center = featureCenter(feature);
    return Math.min(distance(center, start), distance(center, finish));
  };
  const selectedGreen = explicitlyMatchedGreen || (selectedHole
    ? features
      .filter((feature) => feature.tags.golf === "green" && holeReference(feature) == null)
      .map((feature) => ({ feature, distance: endpointDistance(feature) }))
      .filter((item) => item.distance <= 120)
      .sort((a, b) => a.distance - b.distance)[0]?.feature
    : null);
  const targetGreen = selectedGreen ? featureCenter(selectedGreen) : finish;

  return features.filter((feature) => {
    if (feature === selectedHole || feature === selectedGreen) return true;
    const ref = holeReference(feature);
    if (ref != null) return ref === number;
    const type = feature.tags.golf;
    if (type === "hole" || type === "green") return false;

    const center = featureCenter(feature);
    if (!center) return false;
    if (type === "pin") return distance(center, targetGreen) <= 18;
    if (type === "tee") return distance(center, start) <= 45;

    const points = coordinatesOf(feature);
    const routeDistance = distanceToRoute(center, route);
    if (routeDistance > 45) return false;
    // Keep only features whose full outline follows this hole's corridor.
    // This drops broad/shared course areas that make neighboring holes appear.
    return points.every((point) => distanceToRoute(point, route) <= 70);
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
