# Varun Assistant — Flutter App

A Flutter port of the Varun Assistant (originally React Native/Expo). Same
behaviour, same backend. The user types or speaks a request in **English, Hindi,
or Hinglish**; the backend (Claude) interprets it into one action; the app
performs that action on-device using the user's permissions.

## Architecture (important)

This app is a **thin client**. The intelligence lives on a backend server:

```
Flutter app  ──HTTPS──>  Backend (Node/Express on a DigitalOcean droplet)
  (this repo)              ├─ Claude  (understands the request)
                           ├─ OpenAI Whisper (voice → text)
                           └─ Gmail API (read/send email)
```

- The app holds only `APP_TOKEN` (in `lib/config.dart`) — **no API keys**.
- All secrets (Claude, OpenAI, Google) stay on the server.
- Backend base URL + token are in **`lib/config.dart`**.

The backend is the same one used by the React Native app and is already deployed
and running. If you stand up your own backend, point `Config.backendUrl` at it.

## Features

| Feature | How it works |
|---|---|
| 💬 Message a contact on WhatsApp | Finds the contact, opens WhatsApp with the text pre-filled (user taps Send) |
| 📅 Create a calendar meeting | Writes an event to the device calendar |
| 📅 "How many meetings today?" | Reads the device calendar |
| ⏰ Set a reminder | Local notification |
| 📝 Save / list notes | Stored on the backend |
| 📧 Check inbox / read / send email | Gmail (connected via Settings tab → Google OAuth) |
| 🎙️ Voice notes (EN/Hindi/Hinglish) | Recorded, transcribed by the server (Whisper) |

Language is restricted to **English, Hindi, Hinglish** (enforced server-side).

## Project structure

```
lib/
  main.dart            # App entry + Chat screen + tab navigation
  settings_screen.dart # Gmail credentials/connect UI
  api.dart             # Backend HTTP client (/mobile/* endpoints)
  actions.dart         # On-device executors: contacts, calendar, notifications, WhatsApp
  config.dart          # backendUrl + appToken
```

## Prerequisites

- Flutter SDK (3.5+), Dart 3.5+
- Android Studio / Android SDK (for Android), or Xcode (for iOS, Mac only)

## Run it

```bash
flutter pub get
flutter run            # with an Android device/emulator connected
```

To pick a device:
```bash
flutter devices
flutter run -d <deviceId>
```

## Build a release APK (Android)

```bash
flutter build apk --release
# output: build/app/outputs/flutter-apk/app-release.apk
```

## Build for iOS (Mac + Xcode required)

```bash
flutter build ios --release   # requires a Mac, Xcode, and an Apple Developer account for signing
```

## Configuration

Edit `lib/config.dart`:
```dart
class Config {
  static const String backendUrl = 'https://<your-backend>';
  static const String appToken   = '<must match server .env APP_TOKEN>';
}
```

## Gmail setup (one-time, by the user)

In the app: **Settings tab** → enter the Google OAuth **Client ID + Secret** →
**Save** → **Connect Gmail**. The Settings screen shows the exact redirect URI to
register in Google Cloud Console. (Gmail API enabled, OAuth consent screen with
the user added as a Test user.)
