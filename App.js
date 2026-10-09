
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from "expo-speech-recognition";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import HoleMap from "./src/HoleMap.js";
import { featuresForHole, fetchCourseFeatures, osmCourseQuery } from "./src/courseMap.js";
import {
  addMappedPins,
  coordinatesForCourse,
  parseVoiceCommand,
  startVoiceRecognition
} from "./src/appFeatures.js";
import appConfig from "./app.json";
import { theme, antiGlareTheme, layoutForDevice } from "./src/theme.js";

const AppThemeContext = React.createContext(null);
const STORE = "gemini-golf-caddie-v3";

const START_BAG = [
  ["Driver", 200, 10.5],
  ["3 Wood", 185, 15],
  ["5 Wood", 170, 18],
  ["4 Iron", 160, 22],
  ["5 Iron", 150, 25],
  ["6 Iron", 140, 28],
  ["7 Iron", 130, 32],
  ["8 Iron", 120, 36],
  ["9 Iron", 110, 41],
  ["PW", 100, 46],
  ["GW", 85, 50],
  ["SW", 70, 56],
  ["LW", 55, 60]
].map(([name, carry, loft]) => ({
  name,
  carry,
  loft
}));

function newRound() {
  return {
    name: "Choose your golf course",
    tee: "",
    holes: Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: i === 0 ? 5 : 4,
      length: 0,
      score: "",
      pin: null
    }))
  };
}

function checkKey(input) {
  const key = String(input || "").trim();

  if (!key) {
    throw new Error("Enter your GolfCourseAPI key.");
  }

  if (!/^[\x21-\x7E]+$/.test(key)) {
    throw new Error(
      "Paste the real API key, not hidden dots or bullets."
    );
  }

  if (/^Bearer\s/i.test(key) || /^Key\s/i.test(key)) {
    throw new Error("Paste only the API key.");
  }

  return key;
}

async function golfApi(path, key) {
  const token = checkKey(key);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    20000
  );

  try {
    const response = await fetch(
      "https://api.golfcourseapi.com/v1/" + path,
      {
        headers: {
          Accept: "application/json",
          Authorization: "Key " + token
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "API key rejected."
          : response.status === 403
          ? "API access denied."
          : response.status === 429
          ? "API limit reached."
          : "API error " + response.status
      );
    }

    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("API timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function metresBetween(a, b) {
  if (!a || !b) return null;

  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
    return null;
  }

  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) *
      Math.cos(lat2 * r) *
      Math.sin(dLon / 2) ** 2;

  return 12742000 * Math.asin(
    Math.min(1, Math.sqrt(h))
  );
}

function courseName(c) {
  return [c.club_name, c.course_name]
    .filter(Boolean)
    .join(" - ") || "Golf course";
}

function getTees(c) {
  return Object.entries(c.tees || {}).flatMap(
    ([group, tees]) =>
      Array.isArray(tees)
        ? tees
            .filter(t => Array.isArray(t.holes) && t.holes.length)
            .map((t, i) => ({
              ...t,
              id: group + "-" + i,
              label: (t.tee_name || "Tees") + " (" + group + ")"
            }))
        : []
  );
}

function Button({ title, onPress, primary, disabled }) {
  const { palette, styles } = React.useContext(AppThemeContext);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.button,
        primary && styles.primary,
        disabled && { opacity: 0.5 }
      ]}
    >
      <Text style={[
        styles.buttonText,
        primary && { color: palette.background }
      ]}>
        {title}
      </Text>
    </Pressable>
  );
}

function Field({
  title,
  value,
  onChange,
  placeholder,
  numeric,
  secret
}) {
  const { palette, styles } = React.useContext(AppThemeContext);
  return (
    <View style={{ flex: 1, marginVertical: 5 }}>
      <Text style={styles.small}>{title}</Text>
      <TextInput
        style={styles.input}
        value={String(value ?? "")}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        keyboardType={numeric ? "decimal-pad" : "default"}
        secureTextEntry={secret}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

function Options({ items, value, onChange }) {
  const { palette, styles } = React.useContext(AppThemeContext);
  return (
    <View style={styles.row}>
      {items.map(([label, id]) => (
        <Pressable
          key={id}
          onPress={() => onChange(id)}
          accessibilityRole="radio"
          accessibilityLabel={label}
          accessibilityState={{ selected: value === id }}
          style={[
            styles.option,
            value === id && {
              borderColor: palette.gold,
              backgroundColor: palette.selected
            }
          ]}
        >
          <Text style={styles.small}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function App() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><CaddieApp /></SafeAreaProvider>;
}

function CaddieApp() {
  const { width, fontScale } = useWindowDimensions();
  const deviceLayout = layoutForDevice(width, fontScale);
  const [antiGlare, setAntiGlare] = useState(false);
  const palette = antiGlare ? antiGlareTheme : theme;
  const styles = React.useMemo(() => createStyles(palette), [palette]);
  const GOLD = palette.gold;
  const themeValue = React.useMemo(() => ({ palette, styles }), [palette, styles]);
  const [tab, setTab] = useState("Caddie");
  const [round, setRound] = useState(newRound);
  const [bag, setBag] = useState(START_BAG);
  const [holeIndex, setHoleIndex] = useState(0);

  const [unit, setUnit] = useState("m");
  const [windUnit, setWindUnit] = useState("km/h");
  const [tournament, setTournament] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [courseFeatures, setCourseFeatures] = useState([]);
  const [mapStatus, setMapStatus] = useState("Choose a course and tees to load its hole map.");
  const [mapBusy, setMapBusy] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice is off.");
  const [transcript, setTranscript] = useState("");

  const [gps, setGps] = useState(null);
  const [gpsOn, setGpsOn] = useState(false);
  const [wind, setWind] = useState("0");
  const [windDirection, setWindDirection] = useState("calm");

  const [score, setScore] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [loaded, setLoaded] = useState(false);

  const gpsWatch = useRef(null);
  const mapRequestId = useRef(0);
  const voiceRequestId = useRef(0);
  const voiceRequestPending = useRef(false);
  const voiceActive = useRef(false);
  const mounted = useRef(true);
  const hole = round.holes[holeIndex];

  useEffect(() => {
    mounted.current = true;
    async function restore() {
      try {
        const raw = await AsyncStorage.getItem(STORE);
        if (raw) {
          const d = JSON.parse(raw);
          if (d.round?.holes?.length) setRound(d.round);
          if (Array.isArray(d.bag)) setBag(d.bag);
          if (d.unit) setUnit(d.unit);
          if (d.windUnit) setWindUnit(d.windUnit);
          if (typeof d.tournament === "boolean") {
            setTournament(d.tournament);
          }
          if (typeof d.antiGlare === "boolean") setAntiGlare(d.antiGlare);
          if (Array.isArray(d.courseFeatures)) {
            setCourseFeatures(d.courseFeatures);
            setMapStatus(d.courseFeatures.length
              ? "Saved OpenStreetMap features loaded from this phone."
              : "No saved hole map. Choose a course or tap LOAD / RETRY MAP online.");
          }
        }
      } catch (e) {
        console.warn(e);
      } finally {
        setLoaded(true);
      }
    }

    restore();

    return () => {
      mounted.current = false;
      mapRequestId.current += 1;
      voiceRequestId.current += 1;
      voiceActive.current = false;
      gpsWatch.current?.remove();
      Speech.stop();
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;

    AsyncStorage.setItem(
      STORE,
      JSON.stringify({
        round,
        bag,
        unit,
        windUnit,
        tournament,
        antiGlare,
        courseFeatures
      })
    ).catch(console.warn);
  }, [loaded, round, bag, unit, windUnit, tournament, antiGlare, courseFeatures]);

  function displayDistance(m) {
    if (m == null || !Number.isFinite(Number(m))) {
      return "—";
    }

    return String(Math.round(
      Number(m) * (unit === "yd" ? 1.0936133 : 1)
    ));
  }

  function toMetres(value) {
    const n = Number(value) || 0;
    return unit === "yd" ? n * 0.9144 : n;
  }

  function editHole(patch) {
    setRound(r => ({
      ...r,
      holes: r.holes.map((h, i) =>
        i === holeIndex ? { ...h, ...patch } : h
      )
    }));
  }

  function go(direction) {
    setHoleIndex(i =>
      (i + direction + round.holes.length) %
      round.holes.length
    );
    setScore("");
  }

  async function searchCourses() {
    if (busy) return;

    if (!query.trim()) {
      Alert.alert("Course", "Enter a course name.");
      return;
    }

    try {
      checkKey(apiKey);
    } catch (e) {
      setTab("Settings");
      Alert.alert("API key", e.message);
      return;
    }

    setBusy(true);
    setResults([]);
    setSelected(null);
    setStatus("Searching courses...");

    try {
      const data = await golfApi(
        "search?search_query=" +
          encodeURIComponent(query.trim()),
        apiKey
      );

      const courses = Array.isArray(data.courses)
        ? data.courses
        : [];

      setResults(courses);
      setStatus(
        courses.length
          ? "Select your course."
          : "No matches. Try a shorter name."
      );
    } catch (e) {
      setStatus(e.message);
      Alert.alert("Course search", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseCourse(course) {
    if (busy) return;

    setBusy(true);
    setStatus("Loading tees...");

    try {
      const data = await golfApi(
        "courses/" + encodeURIComponent(course.id),
        apiKey
      );

      const full = data.course || data;

      if (!getTees(full).length) {
        throw new Error("No tee scorecard available.");
      }

      setSelected(full);
      setResults([]);
      setStatus("Choose your tees.");
    } catch (e) {
      setStatus(e.message);
      Alert.alert("Course", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadCourseMap(mapRound) {
    const requestId = ++mapRequestId.current;
    if (!mapRound.courseCoordinates) {
      setMapBusy(false);
      setMapStatus("No course coordinates available. GPS still works with a manually saved green pin.");
      return;
    }

    setMapBusy(true);
    setMapStatus("Loading OpenStreetMap hole features...");
    try {
      const { latitude, longitude } = mapRound.courseCoordinates;
      const elements = await fetchCourseFeatures(osmCourseQuery(latitude, longitude));
      if (!mounted.current || requestId !== mapRequestId.current) return;
      setCourseFeatures(elements);
      setRound(current => current.courseKey === mapRound.courseKey
        ? addMappedPins(current, elements) : current);
      setMapStatus(elements.length
        ? "OpenStreetMap features loaded. Detail varies by hole."
        : "No mapped features found here. Your scorecard is saved; mark the green manually for GPS.");
    } catch {
      if (!mounted.current || requestId !== mapRequestId.current) return;
      setMapStatus("Map service unavailable. Saved maps, scores and green pins are unchanged. Retry online.");
    } finally {
      if (mounted.current && requestId === mapRequestId.current) setMapBusy(false);
    }
  }

  function loadTee(tee) {
    if (!selected) return;

    const next = {
      name: courseName(selected),
      tee: tee.label,
      courseKey: String(selected.id ?? courseName(selected)) + ":" + tee.id,
      courseCoordinates: coordinatesForCourse(selected),
      holes: tee.holes.map((h, i) => ({
        number: i + 1,
        par: Number(h.par) || 4,
        length:
          Number(h.meters) ||
          Number(h.yardage || 0) * 0.9144,
        score: "",
        pin: null
      }))
    };

    const apply = () => {
      setRound(next);
      setHoleIndex(0);
      setScore("");
      setSelected(null);
      setResults([]);
      setCourseFeatures([]);
      setStatus("Course and scorecard loaded.");
      void loadCourseMap(next);
    };

    if (round.holes.some(h => h.score !== "")) {
      Alert.alert(
        "New round",
        "Replace current scores?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Load", onPress: apply }
        ]
      );
    } else {
      apply();
    }
  }

  async function startGps() {
    try {
      const p =
        await Location.requestForegroundPermissionsAsync();

      if (!p.granted) {
        throw new Error("Location permission required.");
      }

      const first =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });

      setGps(first.coords);
      gpsWatch.current?.remove();

      gpsWatch.current =
        await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 2000,
            distanceInterval: 2
          },
          position => setGps(position.coords)
        );

      setGpsOn(true);
      setStatus("GPS active.");
    } catch (e) {
      Alert.alert("GPS", e.message);
    }
  }

  function stopGps() {
    gpsWatch.current?.remove();
    gpsWatch.current = null;
    setGpsOn(false);
  }

  function markGreen() {
    if (!gps) {
      Alert.alert("GPS", "Start GPS first.");
      return;
    }

    Alert.alert(
      "Mark green",
      "Save this GPS position for the current hole?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: () => editHole({
            pin: {
              latitude: gps.latitude,
              longitude: gps.longitude
            }
          })
        }
      ]
    );
  }

  function saveScore() {
    const n = Number(score);

    if (!Number.isInteger(n) || n < 1 || n > 15) {
      Alert.alert("Score", "Enter 1 to 15.");
      return;
    }

    editHole({ score: String(n) });
    setScore("");
    setStatus("Score saved.");
  }

  const distance = metresBetween(gps, hole.pin);

  const windKmh =
    (Number(wind) || 0) *
    (windUnit === "mph" ? 1.609344 : 1);

  let playsLike = distance;

  if (distance != null && !tournament) {
    if (windDirection === "head") {
      playsLike += windKmh * 0.8;
    }
    if (windDirection === "tail") {
      playsLike -= windKmh * 0.6;
    }
    playsLike = Math.max(0, playsLike);
  }

  const club =
    playsLike == null || tournament
      ? null
      : [...bag]
          .filter(c => Number(c.carry) > 0)
          .sort(
            (a, b) =>
              Math.abs(a.carry - playsLike) -
              Math.abs(b.carry - playsLike)
          )[0];

  function caddieAdvice() {
    if (distance == null) {
      Speech.speak(
        "Start GPS and mark the green to get live distance.",
        { language: "en-AU" }
      );
      return;
    }

    let message =
      "Hole " + hole.number +
      ". Distance " + displayDistance(distance) +
      (unit === "m" ? " metres." : " yards.");

    if (!tournament) {
      message +=
        " Plays like " + displayDistance(playsLike) +
        ". Suggested club " +
        (club?.name || "not available") +
        ". Advice only.";
    }

    Speech.stop();
    Speech.speak(message, {
      language: "en-AU",
      rate: 0.9
    });
  }

  async function startVoice() {
    if (voiceRequestPending.current || voiceActive.current) return;
    const requestId = ++voiceRequestId.current;
    voiceRequestPending.current = true;
    voiceActive.current = true;
    setVoicePending(true);
    setVoiceStatus("Checking microphone permission...");
    Speech.stop();
    const result = await startVoiceRecognition(
      ExpoSpeechRecognitionModule,
      () => mounted.current && requestId === voiceRequestId.current
    );
    if (!mounted.current || requestId !== voiceRequestId.current) return;
    voiceRequestPending.current = false;
    voiceActive.current = result.started;
    setVoicePending(false);
    setVoiceListening(result.started);
    setVoiceStatus(result.message);
  }

  function stopVoice() {
    voiceRequestId.current += 1;
    voiceRequestPending.current = false;
    voiceActive.current = false;
    try { ExpoSpeechRecognitionModule.abort(); } catch {}
    setVoicePending(false);
    setVoiceListening(false);
    setVoiceStatus("Voice is off.");
  }

  function handleVoiceCommand(raw) {
    const command = parseVoiceCommand(raw);
    if (!command) return;
    switch (command.type) {
      case "mark-green": markGreen(); break;
      case "next-hole": go(1); break;
      case "previous-hole": go(-1); break;
      case "start-gps": void startGps(); break;
      case "stop-gps": stopGps(); break;
      case "tournament": setTournament(true); break;
      case "practice": setTournament(false); break;
      case "wind":
        setWindDirection(command.direction);
        // Spoken speed uses the currently selected km/h or mph display unit.
        if (command.speed != null) setWind(String(command.speed));
        break;
      case "report": caddieAdvice(); break;
      default:
        setVoiceStatus("Try report yardage, mark green, next hole, headwind 15, or practice mode.");
    }
  }

  useSpeechRecognitionEvent("start", () => {
    if (!voiceActive.current) return;
    setVoiceListening(true);
    setVoiceStatus("Listening — speak now.");
  });
  useSpeechRecognitionEvent("end", () => {
    voiceActive.current = false;
    setVoiceListening(false);
    setVoiceStatus(current => current.startsWith("Listening") ? "Voice is off." : current);
  });
  useSpeechRecognitionEvent("error", event => {
    voiceActive.current = false;
    setVoiceListening(false);
    setVoiceStatus("Voice error: " + event.error + ". Check microphone permission and speech service.");
  });
  useSpeechRecognitionEvent("result", event => {
    if (!voiceActive.current) return;
    const text = event.results?.[0]?.transcript;
    if (!text) return;
    setTranscript(text);
    if (event.isFinal) {
      // Interim and duplicate final events must never move two holes.
      voiceActive.current = false;
      // Keep the start button disabled until the native "end" event arrives.
      handleVoiceCommand(text);
    }
  });

  const completed = round.holes.filter(
    h => h.score !== ""
  ).length;

  const total = round.holes.reduce(
    (sum, h) => sum + (Number(h.score) || 0),
    0
  );

  return (
    <AppThemeContext.Provider value={themeValue}>
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom", "left", "right"]}
      testID="safe-screen"
    >
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={
        Platform.OS === "ios" ? "padding" : undefined
      }
    >
      <ExpoStatusBar style="light" />

      <View style={styles.header}>
        <Text
          style={styles.brand}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          maxFontSizeMultiplier={1.3}
          testID="app-brand"
        >
          DRC GEMINI{"\n"}<Text style={{ color: GOLD }}>GOLF CADDIE</Text>
        </Text>
        <View style={styles.gpsBadge}>
          <Text style={styles.gpsText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {gpsOn ? "GPS ON" : "GPS OFF"}
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabScroller, { height: deviceLayout.tabHeight }]}
        contentContainerStyle={styles.tabs}
        testID="app-tabs"
      >
        {[
          "Caddie",
          "Courses",
          "My Bag",
          "Scorecard",
          "Settings"
        ].map(t => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityLabel={t}
            accessibilityState={{ selected: tab === t }}
            style={[
              styles.tab,
              tab === t && styles.activeTab
            ]}
          >
            <Text style={[styles.tabText, tab === t && { color: GOLD }]} numberOfLines={1}>
              {t}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 12,
          paddingBottom: 40
        }}
        keyboardShouldPersistTaps="handled"
        testID="main-content"
      >
        {tab === "Caddie" && (
          <>
            <View style={styles.panel}>
              <Text style={styles.heading}>
                {round.name}
              </Text>
              <Text style={styles.small}>
                {round.tee || "Current round"}
              </Text>

              <View style={styles.rowBetween}>
                <Button
                  title="PREV"
                  onPress={() => go(-1)}
                />
                <View style={{ alignItems: "center" }}>
                  <Text style={styles.heading}>
                    HOLE {hole.number}
                  </Text>
                  <Text style={styles.gold}>
                    PAR {hole.par}
                  </Text>
                </View>
                <Button
                  title="NEXT"
                  onPress={() => go(1)}
                />
              </View>

              <Text style={styles.small}>
                Hole length: {displayDistance(hole.length)} {unit}
              </Text>
            </View>

            <View style={styles.panel} testID="hole-map-panel">
              <Text style={styles.gold}>HOLE {hole.number} MAP</Text>
              <HoleMap
                features={featuresForHole(courseFeatures, hole.number)}
                status={mapStatus}
                palette={palette}
              />
              <Button
                title={mapBusy ? "LOADING MAP..." : "LOAD / RETRY MAP"}
                onPress={() => loadCourseMap(round)}
                disabled={mapBusy || !round.courseCoordinates}
              />
            </View>

            <View style={styles.panel}>
              <Text style={styles.gold}>LIVE GPS</Text>
              <View style={styles.row}>
                <Button
                  title={gpsOn ? "STOP GPS" : "START GPS"}
                  onPress={gpsOn ? stopGps : startGps}
                  primary
                />
                <Button
                  title="MARK GREEN"
                  onPress={markGreen}
                />
              </View>
              <Text style={styles.small}>
                {gps ? "GPS fix received" : "Waiting for GPS"}
              </Text>
              <Text style={styles.small}>
                {hole.pin ? "Green position saved" : "Green not marked"}
              </Text>
            </View>

            <View style={styles.row}>
              <View style={[styles.metric, { flexBasis: deviceLayout.metricBasis }]}>
                <Text style={styles.small}>TO GREEN</Text>
                <Text style={styles.number}>
                  {displayDistance(distance)}
                </Text>
                <Text style={styles.small}>{unit}</Text>
              </View>
              <View style={[styles.metric, { flexBasis: deviceLayout.metricBasis }]}>
                <Text style={styles.small}>PLAYS LIKE</Text>
                <Text style={styles.number}>
                  {tournament ? "—" : displayDistance(playsLike)}
                </Text>
                <Text style={styles.small}>{unit}</Text>
              </View>
              <View style={[styles.metric, { flexBasis: deviceLayout.metricBasis }]}>
                <Text style={styles.small}>CLUB</Text>
                <Text style={styles.number}>
                  {club?.name || "—"}
                </Text>
              </View>
            </View>

            {!tournament && (
              <View style={styles.panel}>
                <Text style={styles.gold}>WIND</Text>
                <Field
                  title={"Wind speed (" + windUnit + ")"}
                  value={wind}
                  onChange={setWind}
                  numeric
                />
                <Options
                  value={windDirection}
                  onChange={setWindDirection}
                  items={[
                    ["CALM", "calm"],
                    ["HEAD", "head"],
                    ["TAIL", "tail"],
                    ["CROSS", "cross"]
                  ]}
                />
              </View>
            )}

            <View style={styles.panel}>
              <Text style={styles.gold}>VOICE CADDIE</Text>
              <View style={styles.row}>
                <Button
                  title={voicePending ? "STARTING VOICE..." : voiceListening ? "LISTENING..." : "TAP TO SPEAK"}
                  onPress={startVoice}
                  disabled={voicePending || voiceListening}
                  primary
                />
                <Button
                  title="STOP LISTENING"
                  onPress={stopVoice}
                  disabled={!voicePending && !voiceListening}
                />
              </View>
              <Text style={styles.small}>{voiceStatus}</Text>
              {transcript ? <Text style={styles.white}>{transcript}</Text> : null}
              <Text style={styles.small}>
                Try report yardage, mark green, next hole, headwind 15, or practice mode.
              </Text>
              <Button
                title="HEAR CADDIE ADVICE"
                onPress={caddieAdvice}
                primary
              />
              <Button
                title="STOP SPEAKING"
                onPress={() => Speech.stop()}
              />
            </View>

            <View style={styles.panel}>
              <Text style={styles.gold}>QUICK SCORE</Text>
              <View style={styles.row}>
                <Field
                  title={"Hole " + hole.number + " strokes"}
                  value={score}
                  onChange={setScore}
                  numeric
                  placeholder={hole.score || "Score"}
                />
                <Button
                  title="SAVE SCORE"
                  onPress={saveScore}
                  primary
                />
              </View>
            </View>
          </>
        )}

        {tab === "Courses" && (
          <>
            <View style={styles.panel}>
              <Text style={styles.heading}>FIND COURSE</Text>
              <Field
                title="Course name"
                value={query}
                onChange={setQuery}
                placeholder="Search worldwide"
              />
              <Button
                title={busy ? "SEARCHING..." : "SEARCH COURSES"}
                onPress={searchCourses}
                primary
                disabled={busy}
              />
              <Text style={styles.small}>{status}</Text>
            </View>

            {results.map(c => (
              <Pressable
                key={String(c.id)}
                style={styles.panel}
                onPress={() => chooseCourse(c)}
              >
                <Text style={styles.white}>
                  {courseName(c)}
                </Text>
                <Text style={styles.small}>
                  {c.location?.city || ""}
                </Text>
              </Pressable>
            ))}

            {selected && (
              <View style={styles.panel}>
                <Text style={styles.gold}>SELECT TEES</Text>
                {getTees(selected).map(t => (
                  <Button
                    key={t.id}
                    title={t.label}
                    onPress={() => loadTee(t)}
                  />
                ))}
              </View>
            )}
          </>
        )}

        {tab === "My Bag" && (
          <View style={styles.panel}>
            <Text style={styles.heading}>MY BAG</Text>
            {bag.map((c, i) => (
              <View key={i} style={styles.clubRow}>
                <Text style={[styles.white, { width: 75 }]}>
                  {c.name}
                </Text>
                <Field
                  title={"Carry " + unit}
                  value={displayDistance(c.carry)}
                  onChange={v => setBag(old =>
                    old.map((item, j) =>
                      i === j
                        ? { ...item, carry: toMetres(v) }
                        : item
                    )
                  )}
                  numeric
                />
                <Field
                  title="Loft"
                  value={c.loft}
                  onChange={v => setBag(old =>
                    old.map((item, j) =>
                      i === j
                        ? { ...item, loft: Number(v) || 0 }
                        : item
                    )
                  )}
                  numeric
                />
              </View>
            ))}
          </View>
        )}

        {tab === "Scorecard" && (
          <View style={styles.panel}>
            <Text style={styles.heading}>SCORECARD</Text>
            <Text style={styles.small}>{round.name}</Text>
            <Text style={styles.gold}>
              {completed} HOLES · {total} STROKES
            </Text>

            {round.holes.map((h, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  setHoleIndex(i);
                  setTab("Caddie");
                }}
                style={styles.scoreRow}
              >
                <Text style={styles.white}>
                  Hole {h.number}
                </Text>
                <Text style={styles.small}>
                  Par {h.par}
                </Text>
                <Text style={styles.gold}>
                  {h.score || "—"}
                </Text>
              </Pressable>
            ))}

            <Button
              title="CLEAR SCORES"
              onPress={() => Alert.alert(
                "Clear scores?",
                "Remove scores from this round?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    onPress: () => setRound(r => ({
                      ...r,
                      holes: r.holes.map(h => ({
                        ...h,
                        score: ""
                      }))
                    }))
                  }
                ]
              )}
            />
          </View>
        )}

        {tab === "Settings" && (
          <View style={styles.panel}>
            <Text style={styles.heading}>SETTINGS</Text>
            <Text style={styles.gold}>GOLFCOURSEAPI KEY</Text>

            <Field
              title="API key"
              value={apiKey}
              onChange={setApiKey}
              placeholder="Paste actual key"
              secret
            />

            <Button
              title="CHECK KEY"
              primary
              onPress={() => {
                try {
                  checkKey(apiKey);
                  Alert.alert(
                    "Key format",
                    "Key format accepted. Search a course to test access."
                  );
                } catch (e) {
                  Alert.alert("Invalid key", e.message);
                }
              }}
            />

            <Text style={styles.gold}>DISTANCE UNIT</Text>
            <Options
              value={unit}
              onChange={setUnit}
              items={[
                ["METRES", "m"],
                ["YARDS", "yd"]
              ]}
            />

            <Text style={styles.gold}>DISPLAY MODE</Text>
            <Options
              value={antiGlare ? "contrast" : "navy"}
              onChange={value => setAntiGlare(value === "contrast")}
              items={[
                ["NAVY & GOLD", "navy"],
                ["ANTI-GLARE", "contrast"]
              ]}
            />
            <Text style={styles.small}>
              Anti-glare uses solid black, bright text and strong outlines on every screen.
              It improves display contrast but cannot remove reflections from the glass.
            </Text>

            <Text style={styles.gold}>WIND UNIT</Text>
            <Options
              value={windUnit}
              onChange={setWindUnit}
              items={[
                ["KM/H", "km/h"],
                ["MPH", "mph"]
              ]}
            />

            <Text style={styles.gold}>ROUND MODE</Text>
            <Options
              value={tournament ? "tournament" : "practice"}
              onChange={v => setTournament(v === "tournament")}
              items={[
                ["PRACTICE", "practice"],
                ["TOURNAMENT", "tournament"]
              ]}
            />

            <Text style={styles.small}>
              Check competition rules before using electronic distance
              measurement or advice.
            </Text>
            <Text style={styles.gold}>ABOUT THIS BUILD</Text>
            <Text style={styles.small}>
              Version {appConfig.expo.version}. Course search requires your GolfCourseAPI key.
              The key stays in memory only; enter it again after restarting.
              Hole maps use OpenStreetMap and are saved with the round.
              Some courses have no mapped features. Voice requires microphone permission
              and an enabled Android speech service.
            </Text>
          </View>
        )}

        <Text style={[styles.small, { textAlign: "center", marginTop: 15 }]}>
          GPS distances are estimates. Club recommendations are advice only.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
    </AppThemeContext.Provider>
  );
}

function createStyles(palette) {
  const BACKGROUND = palette.background;
  const PANEL = palette.panel;
  const GOLD = palette.gold;
  const WHITE = palette.text;
  const MUTED = palette.muted;
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BACKGROUND
  },
  header: {
    padding: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  brand: {
    color: WHITE,
    fontSize: 16,
    fontWeight: "900",
    flex: 1,
    minWidth: 0
  },
  gpsBadge: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.elevated
  },
  gpsText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700"
  },
  tabScroller: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: palette.tabBar
  },
  tabs: {
    flexDirection: "row",
    flexGrow: 1
  },
  tab: {
    flexGrow: 1,
    flexShrink: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center"
  },
  tabText: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700"
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: GOLD
  },
  panel: {
    backgroundColor: PANEL,
    borderRadius: 12,
    borderWidth: palette.antiGlare ? 2 : 1,
    borderColor: palette.border,
    padding: 12,
    marginVertical: 7
  },
  heading: {
    color: WHITE,
    fontSize: palette.antiGlare ? 19 : 18,
    fontWeight: "900",
    marginVertical: 7
  },
  gold: {
    color: GOLD,
    fontSize: palette.antiGlare ? 13 : 12,
    fontWeight: "900",
    marginVertical: 7
  },
  white: {
    color: WHITE,
    fontSize: 12,
    fontWeight: "700"
  },
  small: {
    color: MUTED,
    fontSize: palette.antiGlare ? 11 : 10,
    lineHeight: 17
  },
  input: {
    color: WHITE,
    fontSize: 15,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: palette.inputBorder
  },
  button: {
    backgroundColor: palette.elevated,
    borderColor: palette.border,
    borderWidth: palette.antiGlare ? 2 : 1,
    borderRadius: 9,
    padding: 11,
    minHeight: 48,
    maxWidth: "100%",
    margin: 3,
    alignItems: "center",
    justifyContent: "center"
  },
  primary: {
    backgroundColor: GOLD,
    borderColor: GOLD,
    borderTopColor: palette.goldHigh,
    borderBottomColor: palette.goldLow
  },
  buttonText: {
    color: WHITE,
    fontSize: palette.antiGlare ? 11 : 10,
    fontWeight: "900",
    alignSelf: "stretch",
    textAlign: "center"
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
    marginVertical: 6
  },
  rowBetween: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 10
  },
  option: {
    borderWidth: palette.antiGlare ? 2 : 1,
    borderColor: palette.inputBorder,
    borderRadius: 8,
    padding: 10,
    minHeight: 48,
    maxWidth: "100%"
  },
  metric: {
    flexGrow: 1,
    flexShrink: 0,
    alignItems: "center",
    backgroundColor: palette.metric,
    borderWidth: palette.antiGlare ? 2 : 1,
    borderColor: GOLD,
    borderRadius: 9,
    padding: 8
  },
  number: {
    color: GOLD,
    fontSize: 19,
    fontWeight: "900",
    textAlign: "center"
  },
  clubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderBottomWidth: 1,
    borderColor: palette.border
  },
  scoreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
    borderColor: palette.border
  }
});
}
