# Battle Royale Live

Battle Royale Live is a mobile-first React + Vite app for running an outdoor battle royale style match with a shrinking GPS safe zone. It is designed to deploy to GitHub Pages and can later be wrapped as an iOS app with Capacitor.

## Features

- Host dashboard, map setup, player join, live game, and results screens.
- Leaflet + OpenStreetMap interactive maps with no map API key required.
- Host-selected hidden endpoint for the final circle.
- Randomized starting circle center so the endpoint starts inside the first circle without being obvious.
- Smooth timestamp-based circle shrink from the starting diameter to an approximately 1 foot final diameter.
- Haversine distance checks for inside/outside status.
- Outside-zone countdown with shrinking grace time:
  `max(5 seconds, 20 seconds * currentCircleDiameter / startingCircleDiameter)`.
- Firebase Firestore sync when configured, with localStorage simulation fallback when not configured.
- Location permission flow, host cleanup, and safety reminder.
- Local simulation mode with sample players for testing without physically moving.
- PWA-ready manifest for future installability work.

## Local Setup

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. For local-only testing, Firebase is optional; the app will use browser localStorage and label itself `Local sim`.

## Firebase Setup

Firebase is recommended for real matches because multiple phones need shared game state.

1. Create a Firebase project.
2. Enable Firestore Database.
3. Add a web app in Firebase project settings.
4. Create a `.env.local` file for local development:

```bash
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

5. Restart `npm run dev`.

The GitHub Pages workflow currently builds with the `battleroyaleirl` Firebase web app config so invite links can sync across phones on the deployed site.

The included `firestore.rules` file is intentionally open for prototype field testing. In Firebase Console, publish equivalent rules for `matches/{code}` or start Firestore in test mode. For a real public game app, lock rules down around match codes, host keys, and write limits.

## Map Setup

This app uses Leaflet + OpenStreetMap, so no Google Maps API key is required. The host taps the endpoint on the map, chooses a starting diameter and shrink duration, then starts the match.

The endpoint is stored as host-only match data and is only shown in host view. Player view only receives the visible safe-zone circle.

## Running a Match

1. Tap `Host match`.
2. Tap the map to choose the hidden final endpoint.
3. Keep the default 1 mile starting diameter or change it.
4. Set total shrink time.
5. Create the lobby and share the invite link from the lobby screen.
6. Players open the link, enter a name or use a generated callsign, grant location permission, and join the lobby.
7. The host starts the game when ready.

The host can see active and eliminated players. Players only see their own status unless host mode is active.

## Local Simulation

Without Firebase, match codes work in the same browser using localStorage. On the live game screen, use `Simulation mode` and `Add sample players` to test circle shrinking and player states without walking around.

## Build

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy.yml`, which builds and deploys `dist` with GitHub Pages on pushes to `main`.

To deploy manually with the `gh-pages` package:

```bash
npm run deploy
```

The Vite `base` is set to `./`, which works for GitHub Pages project sites and static wrappers.

## Capacitor iOS Wrapping

After the web app is stable:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Battle Royale Live" "com.example.battleroyalelive"
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
```

Capacitor location support may require adding iOS usage strings such as `NSLocationWhenInUseUsageDescription` to the generated iOS project.

## Safety and Privacy

Use this only in approved outdoor areas. Avoid roads, private property, unsafe terrain, and bystanders. Wear appropriate safety gear and follow local rules.

Player locations are intended for active match use only. Hosts can clear match data from the results screen. For production Firebase use, configure retention and security rules so ended match data is removed or expires.
