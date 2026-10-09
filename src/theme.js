// App chrome palette from the user's navy/black-and-gold reference.
// Map terrain retains semantic green, sand and water colours.
export const theme = {
  antiGlare: false,
  background: "#030B12",
  panel: "#0B1D2C",
  elevated: "#142B3D",
  tabBar: "#06111C",
  map: "#071724",
  metric: "#040D17",
  gold: "#D7B15C",
  goldHigh: "#F9E6A7",
  goldLow: "#997031",
  text: "#F6F1DF",
  muted: "#AFBAC3",
  border: "#675535",
  inputBorder: "#927544",
  selected: "#352C1B"
};

export const antiGlareTheme = {
  ...theme,
  antiGlare: true,
  background: "#000000",
  panel: "#000000",
  elevated: "#151515",
  tabBar: "#000000",
  map: "#000000",
  metric: "#000000",
  gold: "#FFFFFF",
  goldHigh: "#FFFFFF",
  goldLow: "#FFFFFF",
  text: "#FFFFFF",
  muted: "#E1E1E1",
  border: "#FFFFFF",
  inputBorder: "#FFFFFF",
  selected: "#202020"
};

export function layoutForDevice(width, fontScale = 1) {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const contentWidth = Math.max(120, (Number(width) || 393) - 48);
  return {
    // The tab labels stay on one line and scroll horizontally at large text sizes.
    tabHeight: Math.max(48, Math.ceil(16 * scale + 28)),
    // Metrics wrap into additional rows instead of squeezing large text.
    metricBasis: Math.min(contentWidth, 100 * Math.max(1, scale))
  };
}
