# Signal Session for Android

This is the native Android version of Signal Session, built with Kotlin and the Presage SmartSpectra Android SDK. It can be opened as its own Gradle project in Android Studio.

## Requirements

- Android Studio with JDK 17
- Android SDK platform 36.1 or later
- A physical Android phone with a camera
- A Presage SmartSpectra API key

SmartSpectra documents Android support from API 28. Its published device matrix lists Samsung Galaxy S21, A16, and Flip 6; the Galaxy S26 Ultra is not listed, so verify operation on the phone before relying on it for a demo.

## Configure the API key

Copy `local.properties.example` to `local.properties` in this directory and set `presage.apiKey` to your own key. Do not commit this file or share the resulting APK: API-key authentication places the key in the compiled app and is intended here only for a personal, sideloaded demo. Use Presage OAuth before distributing an app.

## Build and install

1. Open the `android/` directory in Android Studio.
2. Let Android Studio sync the Gradle project and install any missing Android SDK platform/build tools.
3. Connect the Samsung phone with USB debugging enabled and accept its debugging prompt.
4. Select the app run configuration and install it on the phone.
5. In the app, have the participant read and accept the consent disclosure before granting camera permission or starting a measurement.

From a terminal, build a debug APK with `.\gradlew.bat :app:assembleDebug` on Windows or `./gradlew :app:assembleDebug` on macOS/Linux. The APK is written to `app/build/outputs/apk/debug/`.

The app requests only SmartSpectra's breathing metric bundle. It disables SDK telemetry and keeps the preview, live readings, and session notes out of the Python backend. Local prompts and notes are stored in the app's private preferences and expire 30 days after first save. Selected media is preview-only and is not saved.

The app stops an active measurement when it leaves the foreground. Start a new measurement after returning.
