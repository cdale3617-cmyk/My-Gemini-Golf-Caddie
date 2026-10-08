
const SUPPORTED = new Set([
  "hole",
  "green",
  "tee",
  "fairway",
  "bunker",
  "water_hazard",
  "pin"
]);

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

const cache = new Map();

export function osmCourseQuery(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Invalid course coordinates.");
  }

  return (
    `[out:json][timeout:45];` +
    `(nwr(around:2200,${latitude},${longitude})` +
    `["golf"];);out geom;`
  );
}

export async function fetchCourseFeatures(
  query,
  fetchImpl = fetch
) {
  if (
    typeof query !== "string" ||
    !query.trim()
  ) {
    throw new Error("Empty map query.");
  }

  const cached = cache.get(query);

  if (
    cached &&
    Date.now() - cached.time < 300000
  ) {
    return cached.elements;
  }

  let lastError;

  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      35000
    );

    try {
      const response = await fetchImpl(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body:
            "data=" + encodeURIComponent(query),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status
        );
      }

      const data = await response.json();

      if (data.remark) {
        throw new Error(
          String(data.remark).slice(0, 180)
        );
      }

      if (!Array.isArray(data.elements)) {
        throw new Error(
          "Invalid OpenStreetMap response."
        );
      }

      const elements = data.elements.filter(
        element =>
          SUPPORTED.has(element.tags?.golf)
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
  if (!feature) return [];

  if (Array.isArray(feature.geometry)) {
    return feature.geometry.filter(
      point =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lon)
    );
  }

  if (
    Number.isFinite(feature.lat) &&
    Number.isFinite(feature.lon)
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

  let lat = 0;
  let lon = 0;

  for (const point of points) {
    lat += point.lat;
    lon += point.lon;
  }

  return {
    lat: lat / points.length,
    lon: lon / points.length
  };
}

function distanceMetres(a, b) {
  const latDifference =
    (a.lat - b.lat) * 111195;

  const lonDifference =
    (a.lon - b.lon) *
    111195 *
    Math.cos(a.lat * Math.PI / 180);

  return Math.hypot(
    latDifference,
    lonDifference
  );
}

function distanceToSegment(point, a, b) {
  const cosine = Math.cos(
    point.lat * Math.PI / 180
  );

  const ax = a.lon * cosine;
  const ay = a.lat;

  const bx = b.lon * cosine;
  const by = b.lat;

  const px = point.lon * cosine;
  const py = point.lat;

  const vx = bx - ax;
  const vy = by - ay;

  const lengthSquared =
    vx * vx + vy * vy;

  const fraction = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          (
            (px - ax) * vx +
            (py - ay) * vy
          ) / lengthSquared
        )
      )
    : 0;

  const nearest = {
    lat: ay + fraction * vy,
    lon: (ax + fraction * vx) / cosine
  };

  return distanceMetres(point, nearest);
}

function distanceToHoleLine(point, hole) {
  const points = getPoints(hole);

  if (!points.length) {
    return Infinity;
  }

  if (points.length === 1) {
    return distanceMetres(
      point,
      points[0]
    );
  }

  let nearest = Infinity;

  for (
    let i = 1;
    i < points.length;
    i++
  ) {
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
    feature?.tags?.hole ??
    "";

  const number = Number(
    String(value).trim()
  );

  if (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 36
  ) {
    return number;
  }

  return null;
}

function assignFeatures(elements) {
  const holes = elements.filter(
    feature =>
      feature.tags?.golf === "hole" &&
      getHoleNumber(feature) !== null
  );

  const assignments = new Map();

  for (const feature of elements) {
    if (
      feature.tags?.golf === "hole"
    ) {
      continue;
    }

    const explicitNumber =
      getHoleNumber(feature);

    if (explicitNumber !== null) {
      assignments.set(
        feature,
        explicitNumber
      );
      continue;
    }

    const centre = getCentre(feature);

    if (
      !centre ||
      !holes.length
    ) {
      continue;
    }

    const candidates = holes.map(
      hole => ({
        number: getHoleNumber(hole),
        distance: distanceToHoleLine(
          centre,
          hole
        )
      })
    );

    candidates.sort(
      (a, b) =>
        a.distance - b.distance
    );

    const first = candidates[0];
    const second = candidates[1];

    if (
      first &&
      first.distance <= 35 &&
      (
        !second ||
        second.distance -
          first.distance > 12
      )
    ) {
      assignments.set(
        feature,
        first.number
      );
    }
  }

  return assignments;
}

export function featuresForHole(
  elements,
  holeNumber
) {
  if (!Array.isArray(elements)) {
    return [];
  }

  const selectedNumber =
    Number(holeNumber);

  const assignments =
    assignFeatures(elements);

  return elements.filter(feature => {
    const type =
      feature.tags?.golf;

    if (!SUPPORTED.has(type)) {
      return false;
    }

    if (type === "hole") {
      return (
        getHoleNumber(feature) ===
        selectedNumber
      );
    }

    return (
      assignments.get(feature) ===
      selectedNumber
    );
  });
}

export function greenPinsByHole(elements) {
  const result = {};

  if (!Array.isArray(elements)) {
    return result;
  }

  const assignments =
    assignFeatures(elements);

  for (const feature of elements) {
    if (
      feature.tags?.golf !== "green"
    ) {
      continue;
    }

    const holeNumber =
      assignments.get(feature);

    const centre =
      getCentre(feature);

    if (
      holeNumber &&
      centre &&
      !result[holeNumber]
    ) {
      result[holeNumber] = {
        latitude: centre.lat,
        longitude: centre.lon
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
  const input = Array.isArray(elements)
    ? elements
    : [];

  const shapes = input
    .filter(
      feature =>
        SUPPORTED.has(
          feature.tags?.golf
        )
    )
    .map(feature => ({
      id:
        String(feature.type || "feature") +
        ":" +
        String(feature.id),
      type: feature.tags.golf,
      coords: getPoints(feature)
    }))
    .filter(
      shape =>
        shape.coords.length > 0
    );

  if (!shapes.length) {
    return {
      shapes: []
    };
  }

  const allPoints =
    shapes.flatMap(
      shape => shape.coords
    );

  const averageLatitude =
    allPoints.reduce(
      (sum, point) =>
        sum + point.lat,
      0
    ) / allPoints.length;

  const cosine = Math.cos(
    averageLatitude *
    Math.PI / 180
  );

  const projected = allPoints.map(
    point => ({
      x: point.lon * cosine,
      y: point.lat
    })
  );

  const minX = Math.min(
    ...projected.map(p => p.x)
  );

  const maxX = Math.max(
    ...projected.map(p => p.x)
  );

  const minY = Math.min(
    ...projected.map(p => p.y)
  );

  const maxY = Math.max(
    ...projected.map(p => p.y)
  );

  const usableWidth =
    Math.max(1, width - 24);

  const usableHeight =
    Math.max(1, height - 24);

  const rangeX = Math.max(
    1e-8,
    maxX - minX
  );

  const rangeY = Math.max(
    1e-8,
    maxY - minY
  );

  const scale = Math.min(
    usableWidth / rangeX,
    usableHeight / rangeY
  );

  const centreX =
    (minX + maxX) / 2;

  const centreY =
    (minY + maxY) / 2;

  return {
    shapes: shapes.map(shape => {
      const coordinates =
        shape.coords;

      const first =
        coordinates[0];

      const last =
        coordinates[
          coordinates.length - 1
        ];

      const closed =
        coordinates.length > 2 &&
        Math.abs(
          first.lat - last.lat
        ) < 1e-7 &&
        Math.abs(
          first.lon - last.lon
        ) < 1e-7;

      const points = coordinates.map(
        point => {
          const x =
            width / 2 +
            (
              point.lon * cosine -
              centreX
            ) * scale;

          const y =
            height / 2 -
            (
              point.lat -
              centreY
            ) * scale;

          return {
            x: Math.max(
              0,
              Math.min(width, x)
            ),
            y: Math.max(
              0,
              Math.min(height, y)
            )
          };
        }
      );

      return {
        id: shape.id,
        type: shape.type,
        closed,
        points
      };
    })
  };
}
