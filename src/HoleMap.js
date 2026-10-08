import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { projectHoleFeatures } from "./courseMap.js";

const COLORS = {
  hole: "#D9B45B",
  fairway: "#799C60",
  green: "#A5BD70",
  bunker: "#D7C79B",
  water_hazard: "#315E6A",
  tee: "#F4E9C2",
  pin: "#E36B56",
};

export default function HoleMap({ features, status }) {
  const projection = projectHoleFeatures(features, 320, 250);
  const polygons = projection.shapes.filter((shape) => shape.closed && !["tee", "pin", "hole"].includes(shape.type));
  const lines = projection.shapes.filter((shape) => (shape.type === "hole" || !shape.closed) && shape.points.length > 1);
  const markers = projection.shapes.filter((shape) => ["tee", "pin"].includes(shape.type) || shape.points.length === 1);
  const hasData = projection.shapes.length > 0;

  return <View style={{ height: 250, backgroundColor: "#143525", alignItems: "center", justifyContent: "center" }}>
    {hasData ? <Svg width="100%" height="100%" viewBox="0 0 320 250" accessibilityLabel="OpenStreetMap golf hole features">
      {polygons.map((shape) => <Polygon key={shape.id} points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")} fill={COLORS[shape.type] || "#739459"} stroke={shape.type === "green" ? "#D5D991" : "#35513B"} strokeWidth={shape.type === "green" ? 2 : 1} opacity={shape.type === "water_hazard" ? 0.92 : 0.96} />)}
      {lines.map((shape) => <Polyline key={shape.id} points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={COLORS[shape.type] || "#D9B45B"} strokeWidth={shape.type === "hole" ? 4 : 2} strokeDasharray={shape.type === "hole" ? "6 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
      {markers.map((shape) => { const point = shape.points[0]; return <Circle key={shape.id} cx={point.x} cy={point.y} r={shape.type === "pin" ? 5 : 4} fill={COLORS[shape.type] || "#F4E9C2"} stroke="#F5F4EC" strokeWidth={1.5} />; })}
    </Svg> : <View style={{ paddingHorizontal: 24, alignItems: "center" }}>
      <Text style={{ color: "#F5F4EC", fontSize: 13, fontWeight: "800", textAlign: "center" }}>No mapped hole found for this course yet</Text>
      <Text style={{ color: "#AAB5AC", fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 }}>GPS distance still works. Save the green pin while you are beside the green. OpenStreetMap course details vary by location.</Text>
    </View>}
    <View pointerEvents="none" style={{ position: "absolute", bottom: 3, left: 6, right: 6, flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: "#E2E9DD", fontSize: 8, fontWeight: "800" }}>{hasData ? "OPENSTREETMAP · COURSE FEATURES" : status || "SEARCH FOR A COURSE TO LOAD ITS MAP"}</Text>
      {hasData ? <Text style={{ color: "#E2E9DD", fontSize: 8 }}>© OpenStreetMap</Text> : null}
    </View>
  </View>;
}
