import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { transformSync } from "@babel/core";
import jsx from "@babel/plugin-transform-react-jsx";
import commonjs from "@babel/plugin-transform-modules-commonjs";
import React from "react";
import { act, create } from "react-test-renderer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapFixture = [
  { type: "way", id: 1, tags: { golf: "hole", ref: "1" },
    geometry: [{ lat: -23.1, lon: 150.7 }, { lat: -23.101, lon: 150.701 }] },
  { type: "way", id: 2, tags: { golf: "green", ref: "1" },
    geometry: [{ lat: -23.101, lon: 150.701 }, { lat: -23.1011, lon: 150.7011 },
      { lat: -23.101, lon: 150.701 }] },
  { type: "way", id: 3, tags: { golf: "hole", ref: "2" },
    geometry: [{ lat: -23.1, lon: 150.7 }, { lat: -23.102, lon: 150.702 }] }
];
const courseFixture = {
  id: "fixture-course",
  club_name: "Fixture Club",
  course_name: "Fixture Course",
  location: { latitude: "-23.1", longitude: "150.7" },
  tees: { male: [{ tee_name: "Blue", holes: [
    { par: 4, meters: 350 }, { par: 3, meters: 160 }
  ] }] }
};

function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children || []).map(textOf).join("");
}

async function harness(t, options = {}) {
  const saved = [];
  const listeners = {};
  const recognitionCalls = [];
  const speechCalls = [];
  const permissionCalls = [];
  const networkCalls = [];
  const alerts = [];
  const recognition = {
    requestPermissionsAsync: async () => {
      permissionCalls.push("microphone");
      if (options.permissionResponse) return options.permissionResponse();
      return { granted: options.microphoneGranted !== false };
    },
    isRecognitionAvailable: () => options.speechAvailable !== false,
    start: args => recognitionCalls.push({ type: "start", args }),
    abort: () => recognitionCalls.push({ type: "abort" })
  };
  const mockFetch = async url => {
    networkCalls.push(url);
    if (url.includes("/v1/search?")) return { ok: true, json: async () => ({ courses: [courseFixture] }) };
    if (url.includes("/v1/courses/")) return { ok: true, json: async () => ({ course: options.course || courseFixture }) };
    if (url.includes("/api/interpreter")) {
      if (options.mapsFail) throw Error("Map service offline");
      if (options.mapResponse) return options.mapResponse(url);
      return { ok: true, json: async () => ({ elements: mapFixture }) };
    }
    throw Error("Test attempted an unexpected network request: " + url);
  };
  const mocks = {
    react: React,
    "react-native": {
      ...Object.fromEntries(["KeyboardAvoidingView", "Pressable", "ScrollView", "StatusBar",
        "Text", "TextInput", "View"].map(name => [name, name])),
      StyleSheet: { create: value => value },
      Platform: { OS: "android" },
      Alert: { alert: (...args) => alerts.push(args) }
    },
    "@react-native-async-storage/async-storage": {
      getItem: async () => options.savedRound ? JSON.stringify(options.savedRound) : null,
      setItem: async (key, value) => { saved.push({ key, value: JSON.parse(value) }); }
    },
    "expo-location": {
      Accuracy: { High: 4 },
      requestForegroundPermissionsAsync: async () => ({ granted: true }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: -23.1, longitude: 150.7 } }),
      watchPositionAsync: async () => ({ remove() {} })
    },
    "expo-speech": {
      stop() {},
      speak: message => speechCalls.push(message)
    },
    "expo-status-bar": { StatusBar: "ExpoStatusBar" },
    "expo-speech-recognition": {
      ExpoSpeechRecognitionModule: recognition,
      useSpeechRecognitionEvent: (name, listener) => {
        React.useEffect(() => {
          listeners[name] = listener;
          return () => { delete listeners[name]; };
        }, [name, listener]);
      }
    },
    "react-native-svg": {
      __esModule: true, default: "Svg", Circle: "Circle", Polygon: "Polygon", Polyline: "Polyline"
    }
  };
  const moduleCache = new Map();
  function load(filename) {
    if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
    if (filename.endsWith(".json")) return JSON.parse(fs.readFileSync(filename, "utf8"));
    const module = { exports: {} };
    moduleCache.set(filename, module);
    const code = transformSync(fs.readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false, plugins: [jsx, commonjs]
    }).code;
    const localRequire = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
      throw Error("Unmocked Android dependency: " + name);
    };
    vm.runInThisContext("(function(exports, require, module, fetch) {\n" + code + "\n})",
      { filename })(module.exports, localRequire, module, mockFetch);
    return module.exports;
  }
  const entry = path.resolve(rootDir, process.env.APP_SOURCE_OVERRIDE || "App.js");
  const App = load(entry).default;
  let renderer;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await act(async () => {
    renderer = create(React.createElement(App));
    await flush();
  });
  t.after(async () => { await act(async () => { renderer.unmount(); }); });
  const buttons = label => renderer.root.findAll(node =>
    node.type === "Pressable" &&
    (node.props.accessibilityLabel === label || textOf(node) === label));
  const click = async label => {
    const matches = buttons(label);
    assert.equal(matches.length, 1, "Missing or duplicate app button: " + label);
    assert.notEqual(matches[0].props.disabled, true, "App button is disabled: " + label);
    await act(async () => { await matches[0].props.onPress(); await flush(); });
  };
  const tab = async label => {
    const match = renderer.root.findAll(node => node.type === "Pressable" && textOf(node) === label)[0];
    assert.ok(match, "Missing tab " + label);
    await act(async () => { match.props.onPress(); await flush(); });
  };
  const enter = async (predicate, value) => {
    const input = renderer.root.findAll(node => node.type === "TextInput" && predicate(node.props))[0];
    assert.ok(input, "Missing app input");
    await act(async () => { input.props.onChangeText(value); await flush(); });
  };
  const chooseCourse = async () => {
    await tab("Settings");
    await enter(props => props.secureTextEntry, "fixture-key-not-a-secret");
    await tab("Courses");
    await enter(props => props.placeholder === "Search worldwide", "Fixture");
    await click("SEARCH COURSES");
    const course = renderer.root.findAll(node =>
      node.type === "Pressable" && textOf(node).includes("Fixture Club"))[0];
    assert.ok(course, "Course result is not displayed");
    await act(async () => { await course.props.onPress(); await flush(); });
    await click("Blue (male)");
    await tab("Caddie");
  };
  const emit = async (name, event) => {
    assert.equal(typeof listeners[name], "function", "Missing native speech listener: " + name);
    await act(async () => { listeners[name](event); await flush(); });
  };
  return {
    renderer, saved, recognitionCalls, speechCalls, permissionCalls, networkCalls, alerts,
    click, tab, enter, chooseCourse, emit,
    allText: () => renderer.root.findAllByType("Text").map(textOf).join("\n")
  };
}

test("App renders the map panel and microphone controls without activating the microphone", async t => {
  const app = await harness(t);
  assert.equal(app.renderer.root.findAllByProps({ testID: "hole-map-panel" }).length, 1);
  assert.ok(app.allText().includes("TAP TO SPEAK"));
  assert.ok(app.allText().includes("STOP LISTENING"));
  assert.equal(app.permissionCalls.length, 0);
  assert.equal(app.recognitionCalls.length, 0);
  assert.ok(app.saved.every(item => item.key === "gemini-golf-caddie-v3"));
});

test("actual course/tee controls load and render numbered hole geometry and persist mapped pins", async t => {
  const app = await harness(t);
  await app.chooseCourse();
  assert.equal(app.renderer.root.findAllByType("Svg").length, 1, "HoleMap must be wired into App");
  assert.equal(app.renderer.root.findAllByType("Polyline").length, 1, "Only the current hole is displayed");
  assert.equal(app.renderer.root.findAllByType("Polygon").length, 1);
  assert.match(app.allText(), /OpenStreetMap features loaded/);
  const saved = app.saved.at(-1).value;
  assert.equal(saved.round.name, "Fixture Club - Fixture Course");
  assert.equal(saved.round.holes.length, 2);
  assert.ok(saved.round.holes[0].pin);
  assert.equal(saved.round.holes[1].pin, null, "No green coordinates may be invented");
  assert.deepEqual(saved.courseFeatures, mapFixture);
  await app.click("START GPS");
  await app.click("HEAR CADDIE ADVICE");
  assert.match(app.speechCalls.at(-1), /Hole 1\. Distance \d+ metres/);
  assert.match(app.speechCalls.at(-1), /Suggested club/);
  await app.enter(props => props.placeholder === "Score", "5");
  await app.click("SAVE SCORE");
  await app.click("LOAD / RETRY MAP");
  assert.equal(app.saved.at(-1).value.round.holes[0].score, "5");
  await app.click("NEXT");
  assert.equal(app.renderer.root.findAllByType("Polygon").length, 0, "Hole 1's green must not appear on hole 2");
  assert.equal(app.renderer.root.findAllByType("Polyline").length, 1);
});

test("App routes final voice commands, ignores partial/duplicate commands, and updates the visible hole", async t => {
  const app = await harness(t);
  await app.click("TAP TO SPEAK");
  assert.equal(app.recognitionCalls.filter(c => c.type === "start").length, 1);
  await app.emit("result", { isFinal: false, results: [{ transcript: "next hole" }] });
  assert.match(app.allText(), /HOLE 1 MAP/);
  await app.emit("result", { isFinal: true, results: [{ transcript: "next hole" }] });
  assert.match(app.allText(), /HOLE 2 MAP/);
  await app.emit("result", { isFinal: true, results: [{ transcript: "next hole" }] });
  assert.match(app.allText(), /HOLE 2 MAP/, "Duplicate final event must not skip a hole");
  await app.emit("end", {});
  await app.click("TAP TO SPEAK");
  await app.emit("result", { isFinal: true, results: [{ transcript: "headwind 15" }] });
  assert.ok(app.renderer.root.findAllByType("TextInput").some(input => input.props.value === "15"));
  await app.emit("end", {});
  await app.click("TAP TO SPEAK");
  await app.emit("result", { isFinal: true, results: [{ transcript: "report yardage" }] });
  assert.match(app.speechCalls.at(-1), /Start GPS and mark the green/);
});

test("App explains denied microphone permission without removing the voice controls or starting recognition", async t => {
  const app = await harness(t, { microphoneGranted: false });
  await app.click("TAP TO SPEAK");
  assert.match(app.allText(), /Allow microphone permission/);
  assert.equal(app.recognitionCalls.filter(c => c.type === "start").length, 0);
  assert.match(app.allText(), /TAP TO SPEAK/);
});

test("App explains missing Android speech service instead of treating it as a missing app control", async t => {
  const app = await harness(t, { speechAvailable: false });
  await app.click("TAP TO SPEAK");
  assert.match(app.allText(), /Speech service unavailable/);
  assert.equal(app.recognitionCalls.filter(c => c.type === "start").length, 0);
});

test("map-service failure leaves the selected scorecard usable and offers a retry without fabricated geography", async t => {
  const app = await harness(t, { mapsFail: true });
  await app.chooseCourse();
  assert.match(app.allText(), /Map service unavailable/);
  assert.equal(app.renderer.root.findAllByType("Svg").length, 0);
  assert.equal(app.saved.at(-1).value.round.holes.length, 2);
  assert.ok(app.saved.at(-1).value.round.holes.every(hole => hole.pin === null));
  await app.click("LOAD / RETRY MAP");
  assert.match(app.allText(), /Map service unavailable/);
});

test("saved maps, bag, scores and green pins survive reopening with the existing storage key", async t => {
  const manualPin = { latitude: -23.12, longitude: 150.72 };
  const savedRound = {
    round: { name: "Saved course", tee: "Blue", courseKey: "saved:blue",
      courseCoordinates: { latitude: -23.1, longitude: 150.7 },
      holes: [{ number: 1, par: 4, length: 350, score: "5", pin: manualPin }] },
    bag: [{ name: "Custom iron", carry: 125, loft: 32 }],
    unit: "m", windUnit: "km/h", tournament: false, courseFeatures: mapFixture
  };
  const app = await harness(t, { savedRound });
  assert.equal(app.renderer.root.findAllByType("Svg").length, 1);
  assert.match(app.allText(), /Saved OpenStreetMap features loaded/);
  await app.click("LOAD / RETRY MAP");
  const saved = app.saved.at(-1).value;
  assert.equal(saved.round.holes[0].score, "5");
  assert.deepEqual(saved.round.holes[0].pin, manualPin);
  assert.deepEqual(saved.bag, savedRound.bag);
});

test("STOP LISTENING cancels recognition and does not execute later stale results", async t => {
  const app = await harness(t);
  await app.click("TAP TO SPEAK");
  await app.click("STOP LISTENING");
  assert.ok(app.recognitionCalls.some(c => c.type === "abort"));
  await app.emit("result", { isFinal: true, results: [{ transcript: "next hole" }] });
  assert.match(app.allText(), /HOLE 1 MAP/);
});

test("a course without coordinates retains its scorecard and never requests invented map geography", async t => {
  const app = await harness(t, { course: { ...courseFixture, location: {} } });
  await app.chooseCourse();
  assert.match(app.allText(), /No course coordinates available/);
  assert.equal(app.networkCalls.filter(url => url.includes("/api/interpreter")).length, 0);
  assert.equal(app.saved.at(-1).value.round.holes.length, 2);
  assert.equal(app.renderer.root.findAllByType("Svg").length, 0);
});

test("a late response from a previously selected course cannot overwrite the new round or map", async t => {
  let resolveOldMap;
  const oldResponse = new Promise(resolve => { resolveOldMap = resolve; });
  let mapRequests = 0;
  const newFeatures = mapFixture.map(feature => ({ ...feature, id: feature.id + 100 }));
  const options = {
    mapResponse: async () => ++mapRequests === 1 ? oldResponse
      : { ok: true, json: async () => ({ elements: newFeatures }) }
  };
  const app = await harness(t, options);
  await app.chooseCourse();
  assert.match(app.allText(), /LOADING MAP/);
  options.course = { ...courseFixture, id: "different-course", course_name: "New Course",
    location: { latitude: -23.2, longitude: 150.8 } };
  await app.chooseCourse();
  assert.equal(app.saved.at(-1).value.round.name, "Fixture Club - New Course");
  await act(async () => {
    resolveOldMap({ ok: true, json: async () => ({ elements: mapFixture }) });
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(app.saved.at(-1).value.round.name, "Fixture Club - New Course");
  assert.deepEqual(app.saved.at(-1).value.courseFeatures, newFeatures);
});

test("canceling while the microphone permission prompt is open prevents delayed recognition startup", async t => {
  let resolvePermission;
  const permission = new Promise(resolve => { resolvePermission = resolve; });
  const app = await harness(t, { permissionResponse: () => permission });
  const start = app.renderer.root.findAll(node =>
    node.type === "Pressable" && node.props.accessibilityLabel === "TAP TO SPEAK")[0];
  await act(async () => {
    void start.props.onPress();
    await new Promise(resolve => setImmediate(resolve));
  });
  await app.click("STOP LISTENING");
  await act(async () => {
    resolvePermission({ granted: true });
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(app.recognitionCalls.filter(call => call.type === "start").length, 0);
  assert.match(app.allText(), /Voice is off/);
});
