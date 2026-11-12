# Archived prototype notes

This document describes the earlier browser-only prototype and is retained for history. For current setup, SmartSpectra integration, and data handling, use the repository's root `README.md`.

A consent-first frontend concept for structured interview sessions, optional camera preview, and question or media prompts.

## Run locally

Python 3.10+ is recommended. No third-party Python packages are required.

```powershell
python server.py
```

Open `http://127.0.0.1:8000`. The server binds to loopback only; it is not exposed to other computers on the network. To use another local port, run `python server.py --port 8001`.

Run the backend tests with:

```powershell
python -m unittest -v
```

## Local backend and data

- After the participant reviews and agrees to the disclosure, the app saves one current session (question prompts and notes) to `~/.signal-session/sessions.sqlite3` under the account running the server.
- The record expires 30 days after its first save; edits do not extend the expiry. Expired records are physically removed on server startup or the next session API request, so the file can remain on disk longer if the server is not run. The participant can remove the saved copy sooner with **Delete saved copy** or by withdrawing consent.
- Session media files, video, audio, physiological readings, and facial-expression data are not sent to or stored by the backend. Media selected for a prompt must be selected again after reloading.
- The SQLite database is local to this computer. The server binds to `127.0.0.1`; there is no account, cloud sync, analytics, SmartSpectra telemetry, or AI service.
- The local server prints request paths and status to its terminal, but does not log request bodies, notes, or prompt contents. A future remote host would have separate access logs and retention that need to be disclosed.
- If the page is opened without `server.py`, camera preview can still be used with consent, but session data cannot be saved. The UI reports this explicitly.

The browser and operating system control their own camera permission settings. This app requests video only, not microphone audio. It shows a live preview and does not record, analyze, or upload video.

## Prototype scope

- Pulse and breathing values and waveforms are static sample data, not measured by SmartSpectra.
- Facial-expression cues are not connected and are not a sentiment or truth score.
- The session controls only demonstrate the interface; no SDK session or recording is started.

## SmartSpectra integration

Presage's current SmartSpectra documentation lists Android, iOS, C++, and Node.js/Electron integrations; it does not document a standalone browser SDK. To use live SmartSpectra readings in a web experience, the frontend needs a supported host such as Electron with the Node.js SDK, or a separately implemented trusted service that owns the SDK integration. Do not expose an SDK API key in browser code.

The production integration should replace the sample metrics with SDK-decoded values and their confidence/validation status. Preserve the participant's ability to consent, stop the camera, and understand what is measured and stored. Physiological measurements and facial-expression classifications cannot establish truthfulness and must not be presented as a lie-detection result.

References:

- [SmartSpectra SDK documentation](https://presagetech.com/docs/smartspectra-sdk)
- [Node.js and Electron SDK guide](https://presagetech.com/docs/smartspectra-sdk/nodejs)
- [SmartSpectra model cards and limitations](https://presagetech.com/docs/smartspectra-sdk/model-cards-and-limitations)
