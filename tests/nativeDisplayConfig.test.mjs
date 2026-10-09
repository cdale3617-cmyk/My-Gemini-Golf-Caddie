import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const withSplashScreen = require("expo-splash-screen/app.plugin.js").default;
const { compileModsAsync } = require("expo/config-plugins");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function splashOptions() {
  const config = JSON.parse(await fs.readFile(path.join(projectRoot, "app.json"), "utf8"));
  return config.expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === "expo-splash-screen")[1];
}

test("plain dark startup references a real, fully transparent Android vector", async () => {
  const options = await splashOptions();
  const icon = options.android?.drawable?.icon;
  assert.ok(icon, "A colour-only splash configuration leaves splashscreen_logo unresolved.");
  const source = await fs.readFile(path.resolve(projectRoot, icon), "utf8");
  assert.match(source, /<vector\b/);
  assert.match(source, /android:fillColor="#00000000"/);
  assert.doesNotMatch(source, /<gradient\b/);
  assert.equal(options.backgroundColor, "#030B12");
  assert.equal(options.dark.backgroundColor, "#000000");
});

test("the installed Expo splash plugin generates the drawable required by Android resource linking", async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "drc-native-display-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const options = await splashOptions();
  const sourcePath = path.resolve(projectRoot, options.android.drawable.icon);
  const fixturePath = path.resolve(tempRoot, options.android.drawable.icon);
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.copyFile(sourcePath, fixturePath);
  await fs.mkdir(path.join(tempRoot, "android/app/src/main/res/drawable"), { recursive: true });
  const configured = withSplashScreen({
    name: "DRC native display fixture",
    slug: "drc-native-display-fixture",
    _internal: { projectRoot: tempRoot }
  }, options);
  // Exercise the SDK's native file-generation mods without requiring an SDK/JDK
  // or unrelated manifest/MainActivity fixtures in this unit test.
  configured.mods = { android: { dangerous: configured.mods.android.dangerous } };
  await compileModsAsync(configured, {
    projectRoot: tempRoot,
    platforms: ["android"],
    skipEmptyMods: true,
    assertMissingModProviders: false
  });
  const generated = path.join(tempRoot, "android/app/src/main/res/drawable/splashscreen_logo.xml");
  assert.equal(await fs.readFile(generated, "utf8"), await fs.readFile(sourcePath, "utf8"));
});
