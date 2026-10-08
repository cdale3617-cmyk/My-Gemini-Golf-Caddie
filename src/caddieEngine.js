export const METRES_PER_YARD = 0.9144;

export function haversineMetres(a, b) {
  if (!a || !b) return null;
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, h))));
}

export function metresToDisplay(metres, unit = "m") {
  if (!Number.isFinite(metres)) return "—";
  return Math.round(unit === "yd" ? metres / METRES_PER_YARD : metres);
}

export function displayToMetres(value, unit = "m") {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(unit === "yd" ? n * METRES_PER_YARD : n);
}

export function calculatePlaysLike({ distanceM, windKmh = 0, windDirection = "calm", elevationM = 0, shotType = "stock", tournamentMode = false }) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  const speed = Math.max(0, Number(windKmh) || 0);
  const windFactor = windDirection === "head" ? 0.22 : windDirection === "tail" ? -0.14 : 0;
  const elevation = tournamentMode ? 0 : Number(elevationM) || 0;
  const swing = shotType === "smooth" ? 0.91 : shotType === "choke-down" ? 0.95 : 1;
  return Math.max(1, Math.round((distanceM + speed * windFactor + elevation) / swing));
}

export function recommendClub(playsLikeM, clubs) {
  if (!Number.isFinite(playsLikeM) || playsLikeM <= 0 || !Array.isArray(clubs)) return null;
  return clubs.reduce((best, club) => {
    const carry = Number(club.carryM);
    if (!Number.isFinite(carry) || carry <= 0) return best;
    return !best || Math.abs(carry - playsLikeM) < Math.abs(best.carryM - playsLikeM) ? club : best;
  }, null);
}

export function makeDefaultRound() {
  return { courseName: "My Course", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, lengthM: 350, score: "", pin: null })) };
}

export function makeDefaultBag() {
  return [["Driver",220,10.5],["3 Wood",195,15],["5 Wood",180,18],["4 Iron",170,22],["5 Iron",160,25],["6 Iron",150,28],["7 Iron",140,32],["8 Iron",130,36],["9 Iron",120,40],["PW",105,45],["GW",90,50],["SW",75,56],["LW",60,60]].map(([name,carryM,loft])=>({name,carryM,loft}));
}
