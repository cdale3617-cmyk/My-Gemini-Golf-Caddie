import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { projectHoleFeatures } from "./courseMap.js";
import { theme } from "./theme.js";

const COLORS = {
  hole: theme.gold,
  fairway: "#799C60",
  green: "#A5BD70",
  bunker: "#D7C79B",
  water_hazard: "#315E6A",
  tee: "#F4E9C2",
  pin: "#E36B56",
};

export default function HoleMap({ features, status, palette = theme }) {
  const colors = palette.antiGlare ? {
    ...COLORS, hole: "#FFFFFF", fairway: "#346C48", green: "#8ADF9B",
    bunker: "#DBDBDB", water_hazard: "#586571", tee: "#FFFFFF", pin: "#FFFFFF"
  } : COLORS;
  const projection = projectHoleFeatures(features, 320, 250);
  const polygons = projection.shapes.filter((shape) => shape.closed && !["tee", "pin", "hole"].includes(shape.type));
  const lines = projection.shapes.filter((shape) => (shape.type === "hole" || !shape.closed) && shape.points.length > 1);
  const markers = projection.shapes.filter((shape) => ["tee", "pin"].includes(shape.type) || shape.points.length === 1);
  const hasData = projection.shapes.length > 0;

  return <View>
    <View testID="map-body" style={[
      { backgroundColor: palette.map, alignItems: "center", justifyContent: "center" },
      hasData ? { height: 250 } : { minHeight: 250, paddingVertical: 16 }
    ]}>
    {hasData ? <Svg width="100%" height={250} viewBox="0 0 320 250" accessibilityLabel="OpenStreetMap golf hole features">
      {polygons.map((shape) => <Polygon key={shape.id} points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")} fill={colors[shape.type] || "#739459"} stroke={palette.antiGlare ? "#FFFFFF" : shape.type === "green" ? "#D5D991" : "#35513B"} strokeWidth={shape.type === "green" || palette.antiGlare ? 2 : 1} opacity={palette.antiGlare ? 1 : shape.type === "water_hazard" ? 0.92 : 0.96} />)}
      {lines.map((shape) => <Polyline key={shape.id} points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={colors[shape.type] || palette.gold} strokeWidth={shape.type === "hole" ? 4 : 2} strokeDasharray={shape.type === "hole" ? "6 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
      {markers.map((shape) => { const point = shape.points[0]; return <Circle key={shape.id} cx={point.x} cy={point.y} r={shape.type === "pin" ? 5 : 4} fill={colors[shape.type] || "#F4E9C2"} stroke={palette.text} strokeWidth={1.5} />; })}
    </Svg> : <View style={{ paddingHorizontal: 24, alignItems: "center" }}>
      <Text style={{ color: palette.text, fontSize: 13, fontWeight: "800", textAlign: "center" }}>No mapped hole found for this course yet</Text>
      <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 }}>GPS distance still works. Save the green pin while you are beside the green. OpenStreetMap course details vary by location.</Text>
    </View>}
    </View>
    {status ? <Text testID="map-status" style={{ color: palette.muted, fontSize: 10, lineHeight: 17, marginTop: 8 }}>{status}</Text> : null}
    {hasData ? <View pointerEvents="none" style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 4 }}>
      <Text style={{ color: palette.muted, fontSize: 8, fontWeight: "800" }}>OPENSTREETMAP · COURSE FEATURES</Text>
      <Text style={{ color: palette.muted, fontSize: 8 }}>© OpenStreetMap</Text>
    </View> : null}
  </View>;
}
