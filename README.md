# My Gemini Golf Caddie

A standalone Expo and React Native golf-caddie app. It keeps one hole in view at a time and saves the round, bag, and settings on the phone.

## Included

- GPS distance from the phone to a green pin saved for each hole.
- Spoken caddie commands and spoken distance and club suggestions.
- Plays-like estimate from distance, wind, elevation, and shot profile.
- Editable club carries and lofts.
- 18-hole scorecard with local saving.
- Metres/yards and km/h/mph settings.
- Practice and tournament modes.
- GitHub Actions tests and Android APK build.

## Current limits

This first build does not contain surveyed course maps, automatic course discovery, live weather, or Gemini API access. The hole picture is an illustration, not geographic data. Save a green pin yourself to use GPS distance. Starting club carries are examples; replace them with your own. Plays-like values are estimates.

Voice recognition uses the speech service installed on the phone. On Android, install or enable Speech Recognition & Synthesis if voice does not start. Voice needs the built APK; it does not work in Expo Go.

## Download the APK

1. Open the repository Actions tab.
2. Select Build Android APK.
3. Run the workflow on main, or wait for its automatic run after a push.
4. Open the completed run and download the My-Gemini-Golf-Caddie-APK artifact.
5. Extract the APK and install it on Android.

The Actions artifact is a debug APK for testing. A signed Play Store release needs a signing setup.

## Local development

Use Node.js 22, then run npm install, npm test, and npx expo start. GPS and native voice need a native Android build.
