
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";

const GREEN = "#0D241B";
const PANEL = "#142D23";
const GOLD = "#D9B45B";
const WHITE = "#F5F4EC";
const MUTED = "#AAB5AC";
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        primary && styles.primary,
        disabled && { opacity: 0.5 }
      ]}
    >
      <Text style={[
        styles.buttonText,
        primary && { color: GREEN }
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
  return (
    <View style={{ flex: 1, marginVertical: 5 }}>
      <Text style={styles.small}>{title}</Text>
      <TextInput
        style={styles.input}
        value={String(value ?? "")}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#819287"
        keyboardType={numeric ? "decimal-pad" : "default"}
        secureTextEntry={secret}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

function Options({ items, value, onChange }) {
  return (
    <View style={styles.row}>
      {items.map(([label, id]) => (
        <Pressable
          key={id}
          onPress={() => onChange(id)}
          style={[
            styles.option,
            value === id && {
              borderColor: GOLD,
              backgroundColor: "#544524"
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

  const [gps, setGps] = useState(null);
  const [gpsOn, setGpsOn] = useState(false);
  const [wind, setWind] = useState("0");
  const [windDirection, setWindDirection] = useState("calm");

  const [score, setScore] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [loaded, setLoaded] = useState(false);

  const gpsWatch = useRef(null);
  const hole = round.holes[holeIndex];

  useEffect(() => {
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
        }
      } catch (e) {
        console.warn(e);
      } finally {
        setLoaded(true);
      }
    }

    restore();

    return () => {
      gpsWatch.current?.remove();
      Speech.stop();
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
        tournament
      })
    ).catch(console.warn);
  }, [loaded, round, bag, unit, windUnit, tournament]);

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

  function loadTee(tee) {
    if (!selected) return;

    const next = {
      name: courseName(selected),
      tee: tee.label,
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
      setStatus("Course and scorecard loaded.");
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

  const completed = round.holes.filter(
    h => h.score !== ""
  ).length;

  const total = round.holes.reduce(
    (sum, h) => sum + (Number(h.score) || 0),
    0
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={
        Platform.OS === "ios" ? "padding" : undefined
      }
    >
      <ExpoStatusBar style="light" />
      <StatusBar
        backgroundColor={GREEN}
        barStyle="light-content"
      />

      <View style={styles.header}>
        <Text style={styles.brand}>
          GEMINI <Text style={{ color: GOLD }}>GOLF CADDIE</Text>
        </Text>
        <Text style={styles.small}>
          {gpsOn ? "GPS ON" : "GPS OFF"}
        </Text>
      </View>

      <View style={styles.tabs}>
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
            style={[
              styles.tab,
              tab === t && styles.activeTab
            ]}
          >
            <Text style={styles.small}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 12,
          paddingBottom: 40
        }}
        keyboardShouldPersistTaps="handled"
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
              <View style={styles.metric}>
                <Text style={styles.small}>TO GREEN</Text>
                <Text style={styles.number}>
                  {displayDistance(distance)}
                </Text>
                <Text style={styles.small}>{unit}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.small}>PLAYS LIKE</Text>
                <Text style={styles.number}>
                  {tournament ? "—" : displayDistance(playsLike)}
                </Text>
                <Text style={styles.small}>{unit}</Text>
              </View>
              <View style={styles.metric}>
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
          </View>
        )}

        <Text style={[styles.small, { textAlign: "center", marginTop: 15 }]}>
          GPS distances are estimates. Club recommendations are advice only.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GREEN
  },
  header: {
    padding: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  brand: {
    color: WHITE,
    fontSize: 16,
    fontWeight: "900"
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#10271E"
  },
  tab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center"
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: GOLD
  },
  panel: {
    backgroundColor: PANEL,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#385541",
    padding: 12,
    marginVertical: 7
  },
  heading: {
    color: WHITE,
    fontSize: 18,
    fontWeight: "900",
    marginVertical: 7
  },
  gold: {
    color: GOLD,
    fontSize: 12,
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
    fontSize: 10,
    lineHeight: 17
  },
  input: {
    color: WHITE,
    fontSize: 15,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "#526B59"
  },
  button: {
    backgroundColor: "#203C30",
    borderColor: "#496150",
    borderWidth: 1,
    borderRadius: 9,
    padding: 11,
    margin: 3,
    alignItems: "center",
    justifyContent: "center"
  },
  primary: {
    backgroundColor: GOLD,
    borderColor: GOLD
  },
  buttonText: {
    color: WHITE,
    fontSize: 10,
    fontWeight: "900"
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
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 10
  },
  option: {
    borderWidth: 1,
    borderColor: "#526B59",
    borderRadius: 8,
    padding: 10
  },
  metric: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#091A13",
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 9,
    padding: 8
  },
  number: {
    color: GOLD,
    fontSize: 19,
    fontWeight: "900"
  },
  clubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderBottomWidth: 1,
    borderColor: "#304739"
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
    borderColor: "#304739"
  }
});
