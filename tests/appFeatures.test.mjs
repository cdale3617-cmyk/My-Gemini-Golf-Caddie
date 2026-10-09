import test from "node:test";
import assert from "node:assert/strict";
import {
  addMappedPins,
  coordinatesForCourse,
  parseVoiceCommand,
  startVoiceRecognition
} from "../src/appFeatures.js";

test("course coordinates accept numeric API strings, but never invent missing geography", () => {
  assert.deepEqual(coordinatesForCourse({ location: { latitude: "-23.1", longitude: "150.7" } }),
    { latitude: -23.1, longitude: 150.7 });
  for (const location of [{}, { latitude: "", longitude: "" },
    { latitude: null, longitude: null }, { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: "bad" }]) {
    assert.equal(coordinatesForCourse({ location }), null);
  }
  assert.deepEqual(coordinatesForCourse({ location: { latitude: 0, longitude: 0 } }),
    { latitude: 0, longitude: 0 });
});

test("mapped pins fill only missing pins and preserve saved scores and manual locations", () => {
  const manualPin = { latitude: -23, longitude: 150 };
  const round = { name: "Saved round", holes: [
    { number: 1, score: "5", pin: manualPin },
    { number: 2, score: "3", pin: null },
    { number: 3, score: "", pin: null }
  ] };
  const features = [1, 2].map(number => ({
    type: "node", id: number, lat: -23.1, lon: 150.7,
    tags: { golf: "green", ref: String(number) }
  }));
  const next = addMappedPins(round, features);
  assert.equal(next.holes[0].pin, manualPin);
  assert.deepEqual(next.holes[1].pin, { latitude: -23.1, longitude: 150.7 });
  assert.equal(next.holes[2].pin, null);
  assert.deepEqual(next.holes.map(h => h.score), ["5", "3", ""]);
  assert.equal(round.holes[1].pin, null, "does not mutate the previous round");
});

test("voice command parser restores navigation, wind, modes, GPS and advice", () => {
  for (const [text, type] of [
    ["NEXT HOLE", "next-hole"], ["previous hole", "previous-hole"],
    ["lock pin", "mark-green"], ["mark green", "mark-green"],
    ["report yardage", "report"], ["what do I hit", "report"],
    ["practice mode", "practice"], ["go official", "tournament"],
    ["start GPS", "start-gps"], ["stop GPS", "stop-gps"]
  ]) assert.equal(parseVoiceCommand(text).type, type);
  assert.deepEqual(parseVoiceCommand("headwind 15.5"), { type: "wind", direction: "head", speed: 15.5 });
  assert.deepEqual(parseVoiceCommand("tailwind"), { type: "wind", direction: "tail", speed: null });
  assert.deepEqual(parseVoiceCommand("calm wind"), { type: "wind", direction: "calm", speed: 0 });
  assert.equal(parseVoiceCommand(""), null);
});

test("voice start requires permission and a speech service before calling the native module", async () => {
  const calls = [];
  const recognition = {
    requestPermissionsAsync: async () => ({ granted: false }),
    isRecognitionAvailable: () => true,
    start: options => calls.push(options)
  };
  const denied = await startVoiceRecognition(recognition);
  assert.equal(denied.started, false);
  assert.match(denied.message, /microphone permission/);
  assert.equal(calls.length, 0);
  recognition.requestPermissionsAsync = async () => ({ granted: true });
  recognition.isRecognitionAvailable = () => false;
  const unavailable = await startVoiceRecognition(recognition);
  assert.equal(unavailable.started, false);
  assert.match(unavailable.message, /Speech service unavailable/);
  assert.equal(calls.length, 0);
  recognition.isRecognitionAvailable = () => true;
  const started = await startVoiceRecognition(recognition);
  assert.equal(started.started, true);
  assert.deepEqual(calls[0], {
    lang: "en-AU", interimResults: true, continuous: false, maxAlternatives: 1
  });
});

test("stopping or unmounting during a permission prompt does not start the microphone later", async () => {
  let started = false;
  const result = await startVoiceRecognition({
    requestPermissionsAsync: async () => ({ granted: true }),
    isRecognitionAvailable: () => true,
    start: () => { started = true; }
  }, () => false);
  assert.equal(result.started, false);
  assert.equal(started, false);
});

test("native recognition startup errors are reported without crashing the app", async () => {
  const result = await startVoiceRecognition({
    requestPermissionsAsync: async () => { throw Error("service failure"); }
  });
  assert.equal(result.started, false);
  assert.match(result.message, /Voice could not start/);
});
