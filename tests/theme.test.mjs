import test from "node:test";
import assert from "node:assert/strict";
import { theme, antiGlareTheme, layoutForDevice } from "../src/theme.js";

test("phone layouts increase tab height and wrap metrics as text size grows", () => {
  assert.equal(layoutForDevice(393, 1).tabHeight, 48);
  assert.equal(layoutForDevice(393, 2).tabHeight, 60);
  assert.equal(layoutForDevice(393, 2).metricBasis, 200);
  assert.ok(layoutForDevice(320, 3).metricBasis <= 272);
});

test("app chrome follows the supplied navy/black and gold palette, not green", () => {
  assert.equal(theme.background, "#030B12");
  assert.equal(theme.panel, "#0B1D2C");
  assert.equal(theme.gold, "#D7B15C");
  assert.equal(theme.text, "#F6F1DF");
});

function luminance(hex) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("anti-glare uses matte black and high-contrast text, labels and outlines", () => {
  for (const key of ["background", "panel", "tabBar", "map", "metric"]) {
    assert.equal(antiGlareTheme[key], "#000000");
  }
  for (const key of ["text", "muted", "gold", "border", "inputBorder"]) {
    const contrast = (luminance(antiGlareTheme[key]) + 0.05) /
      (luminance(antiGlareTheme.background) + 0.05);
    assert.ok(contrast >= 7, key + " must retain strong contrast");
  }
  assert.equal(antiGlareTheme.antiGlare, true);
});
