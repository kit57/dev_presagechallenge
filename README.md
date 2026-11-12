# Signal Session

A consent-first interview workspace with an Electron desktop app and a native Android app using Presage SmartSpectra to display a live breathing-rate signal. It is not a lie detector: breathing and other wellness signals do not establish truthfulness and must not be used for diagnosis, treatment, or medical decisions.

## Requirements

- Node.js 22.12 or newer
- Python 3.10 or newer
- A SmartSpectra API key from Presage
- A camera for live measurements

The SmartSpectra native runtime currently supports Windows x64, macOS arm64, and Linux x64/arm64. See the [SDK documentation](https://www.npmjs.com/package/@smartspectra/node-sdk) for platform requirements.

## Project layout

- `src/renderer/` — HTML, styles, and browser-side app code.
- `src/main/` — Electron main process and SDK preload bridge.
- `backend/` — Python local API and its tests.
- `android/` — native Android app and SmartSpectra integration.
- `docs/` — archived prototype documentation.

## Android app

The native Android version is in [`android/`](./android/README.md). Open that directory in Android Studio, configure `android/local.properties` from its example, then run the app on your phone. The S26 Ultra is not listed in Presage's published tested-device matrix, so verify the camera measurement on the device before recording a demo. API-key authentication embeds the key in the built app; use it only for a private sideloaded build, not an APK you distribute.

## Run locally

1. Install the JavaScript dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and add your local Presage key:

   ```dotenv
   PRESAGE_API_KEY=your_key_here
   ```

   Do not commit or share `.env`. The key is used by SmartSpectra to authenticate with Presage; it is not written to the session database.

3. Start the desktop app:

   ```sh
   npm start
   ```

   This bundles the renderer, starts the Python API on `127.0.0.1:8765`, and opens the Electron app. Set `PYTHON_EXECUTABLE` if Python is not available as `python` on Windows or `python3` on macOS/Linux. Set `SIGNAL_SESSION_PORT` to change the local API port.

4. Have the participant read the consent disclosure and check the agreement themselves. The app asks the operating system for camera access only after consent. Start SmartSpectra and allow a complete measurement window for a breathing-rate estimate.

To run the backend API tests:

```sh
npm test
```

## What the app does

- Requests the SmartSpectra breathing metrics bundle only. Pulse, HRV, expression analysis, and sentiment analysis are not enabled.
- Shows the live breathing estimate with SDK confidence/stability when supplied; the desktop UI also shows a short in-memory trend.
- Processes the live stream through the local SmartSpectra runtime. The app does not record camera video, request microphone access, or save video or breathing values to its Python backend.
- Lets the participant or interviewer prepare neutral questions and preview an image/video stimulus. The selected media file and its preview URL are not saved by this app.
- Saves one set of prompts and notes locally after consent. The challenge entry itself is a solo submission; this app does not verify challenge eligibility.

## Consent and data handling

- **Camera:** The participant must be 18 or older and voluntarily agree before SmartSpectra starts. They can stop measurement or withdraw consent at any time. The app does not support covert or non-consensual monitoring.
- **Processing and sharing:** SmartSpectra receives the live camera stream for local signal processing. This app does not send camera frames or live breathing metrics to its Python backend. SmartSpectra uses the configured API key to authenticate with Presage when a measurement starts. Consult Presage's current terms and privacy documentation for vendor-side handling of authentication requests.
- **Local storage:** On desktop, after consent, only question prompts and notes are stored in `~/.signal-session/sessions.sqlite3`; the Python service listens on loopback (`127.0.0.1`) and does not share session data. On Android, prompts and notes use this app's private preferences on the phone. The Android app disables system backup. The desktop server's request logs contain paths and status codes, not prompt or note contents.
- **Retention and deletion:** On either app, a saved session expires 30 days after its first save; edits do not extend expiry. Desktop records are physically removed the next time the local server starts or its session API is used; Android records are removed the next time the app opens. **Delete saved copy** removes the record immediately. Withdrawing consent stops SmartSpectra and attempts deletion of saved notes and prompts.
- **SDK telemetry:** The app explicitly sets `enableTelemetry: false` when creating the SmartSpectra SDK.
- **AI:** No external or optional AI service is used.

The consent dialog presents these disclosures before any camera processing or local session persistence begins. Browser/operating-system camera permission settings remain under the user's control.

For Android SDK setup and platform-specific requirements, see Presage's [Android Quick Start](https://presagetech.com/docs/smartspectra-sdk/android).

## Challenge demo and submission

For a demo, show the participant reviewing consent, the SmartSpectra measurement starting, and a live breathing-rate estimate appearing after the measurement window. Do not present the estimate as a lie-detection, sentiment, or medical result. Record the demo video separately; public hosting is optional, and this app does not capture or retain it.

The [public code repository](https://github.com/kit57/dev_presagechallenge) is ready to reference in the Presage Challenge submission. The submission also requires a DEV post tagged `#presagechallenge`; publish as an individual participant (18+) and include the setup and data-handling details above. No post or demo video is published by this repository.

## Development

- `npm run build` bundles `src/renderer/app.js` to the ignored `src/renderer/dist/` folder.
- `npm start` builds and launches Electron.
- `npm test` runs the Python backend tests.
