# DRC GEMINI GOLF CADDIE

A standalone Expo and React Native golf-caddie app. It keeps one hole in view at a time and saves the round, bag, and settings on the phone.

## Included

- GPS distance from the phone to a green pin saved for each hole.
- Course search and OpenStreetMap hole features, shown one numbered hole at a time when available.
- Spoken caddie commands and spoken distance and club suggestions.
- Plays-like estimate from distance, wind, elevation, and shot profile.
- Editable club carries and lofts.
- 18-hole scorecard with local saving.
- Metres/yards and km/h/mph settings.
- Practice and tournament modes.
- GitHub Actions tests and Android APK build.

## Current limits

Course search and tee scorecards use GolfCourseAPI. Enter your own key in the app's Settings; it stays in memory only and must be entered again after restarting. Do not put keys in this repository. After selecting a course and tees, hole shapes use OpenStreetMap's Overpass service. Course detail varies; some courses or holes have no coordinates or mapped geometry. For those holes, stand by the green, start GPS, and save the green pin manually. Saved course features and round data stay on the phone. LOAD / RETRY MAP retries online without clearing saved scores or manually saved pins. OpenStreetMap data is © OpenStreetMap contributors and licensed under ODbL; attribution is shown in the app. Starting club carries are examples; replace them with your own. Plays-like values are estimates.

Voice recognition uses the speech service installed on the phone. Tap TAP TO SPEAK and allow microphone permission; spoken commands include report yardage, mark green, next hole, previous hole, headwind 15, practice mode, and tournament mode. Wind commands use the selected km/h or mph unit. STOP LISTENING cancels recognition; HEAR CADDIE ADVICE is the separate text-to-speech button. On Android, enable Speech Recognition & Synthesis if the app reports that no speech service is available. Voice needs the built APK; it does not work in Expo Go.

## Download the APK

1. Open the repository Actions tab.
2. Select Build Android APK.
3. Run the workflow on main, or wait for its automatic run after a push.
4. Open the completed run and download the My-Gemini-Golf-Caddie-APK artifact.
5. Extract the APK and install it on Android.

The workflow assembles the release variant (`app-release.apk`), not the debug variant. This is still a testing build, not a verified store release; a private production signing setup and real-device validation are separate requirements. To keep saved round data, do not uninstall the existing app merely to work around an update/signature error.

## Regression checks and phone validation

`npm test` includes screen-level tests that render App.js with mocked Android services and exercise course/tee selection, SVG hole-map rendering, saved-map restoration, voice permission handling, and final spoken commands. These tests catch disconnected UI integrations; they are not physical-device tests.

Before relying on the app during a round, verify location and microphone permissions, a mapped course, a course with missing geography, spoken commands, and persistence after closing/reopening on the S24. CI success does not prove that the phone's GPS or speech service works. Version 1.0.1 / Android version code 2 restores the map and microphone controls; the package identifier and saved-round storage key are unchanged.

## Local development

Version 1.0.2 / Android version code 3 applies the user's navy/black-and-gold palette and name. The screen now reserves Android status, cutout and navigation areas, keeps tab labels unbroken with horizontal scrolling at large text sizes, and lets empty-map text grow instead of using a fixed-height text overlay. Large-text metrics wrap into additional rows.

Settings → DISPLAY MODE → ANTI-GLARE switches every screen and the map to solid black, bright text and high-contrast outlines. It has no glossy textures or gradients. This is a display-contrast setting, not a physical anti-reflection treatment. The preference is saved with the existing round without changing the Android package or storage key.

Automated layout tests inspect the safe-area structure and large-font rules, not native pixel geometry. A screenshot on the S24 is still required to validate the resulting spacing and native text measurements.

Use Node.js 22, then run npm install, npm test, and npx expo start. GPS and native voice need a native Android build.
