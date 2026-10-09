import { greenPinsByHole } from "./courseMap.js";

export function coordinatesForCourse(course) {
  const lat = course?.location?.latitude;
  const lon = course?.location?.longitude;
  if (lat == null || lon == null ||
      String(lat).trim() === "" || String(lon).trim() === "") return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function addMappedPins(round, elements) {
  const pins = greenPinsByHole(elements);
  return {
    ...round,
    holes: round.holes.map(hole => ({
      ...hole,
      // A retry must not move a pin the golfer already saved.
      pin: hole.pin || pins[hole.number] || null
    }))
  };
}

export function parseVoiceCommand(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  if (/mark green|lock pin|mark target/.test(text)) return { type: "mark-green" };
  if (/tournament mode|go official/.test(text)) return { type: "tournament" };
  if (text.includes("practice mode")) return { type: "practice" };
  if (text.includes("next hole")) return { type: "next-hole" };
  if (/previous hole|prev hole/.test(text)) return { type: "previous-hole" };
  if (/start gps/.test(text)) return { type: "start-gps" };
  if (/stop gps/.test(text)) return { type: "stop-gps" };
  if (/headwind|tailwind|crosswind|calm wind/.test(text)) {
    const number = text.match(/\d+(?:\.\d+)?/);
    const direction = text.includes("headwind") ? "head"
      : text.includes("tailwind") ? "tail"
      : text.includes("crosswind") ? "cross" : "calm";
    return {
      type: "wind",
      direction,
      speed: direction === "calm" ? 0 : number ? Number(number[0]) : null
    };
  }
  if (/report|yardage|distance|what do i hit/.test(text)) return { type: "report" };
  return { type: "unknown" };
}

export async function startVoiceRecognition(recognition, canStart = () => true) {
  try {
    const permission = await recognition.requestPermissionsAsync();
    if (!canStart()) return { started: false, message: "Voice is off." };
    if (!permission.granted) {
      return {
        started: false,
        message: "Allow microphone permission in Android settings to use Voice Caddie."
      };
    }
    if (!recognition.isRecognitionAvailable()) {
      return {
        started: false,
        message: "Speech service unavailable. Enable Speech Recognition & Synthesis in Android settings."
      };
    }
    recognition.start({
      lang: "en-AU",
      interimResults: true,
      continuous: false,
      maxAlternatives: 1
    });
    return { started: true, message: "Listening — speak now." };
  } catch {
    return {
      started: false,
      message: "Voice could not start. Check microphone permission and the phone's speech service."
    };
  }
}
