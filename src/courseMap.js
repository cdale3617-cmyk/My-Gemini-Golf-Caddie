const SUPPORTED = new Set([
  "hole",
  "green",
  "tee",
  "fairway",
  "bunker",
  "water_hazard",
  "pin",
]);

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const cache = new Map();

export async function fetchCourseFeatures(query, fetchImpl = fetch) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Empty map query.");
  }

  const cached = cache.get(query);

  if (cached && Date.now() - cached.time < 300000) {
    return cached.elements;
  }

  const failures = [];

  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const data = await response.json();

      if (data.remark) {
        throw new Error(String(data.remark).slice(0, 180));
      }

      if (!Array.isArray(data.elements)) {
        throw new Error("
