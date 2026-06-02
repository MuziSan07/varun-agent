# Varun Assistant — Mobile App (iOS + Android)

A React Native (Expo) app. You speak or type a request; the backend (Claude)
understands it and the app performs the action **on your phone using your own
permissions** — no third-party automation, no bots on your number.

## What it does (honest capabilities)
| Feature | How | Automatic? |
|---|---|---|
| 📅 "How many meetings today?" | Reads your device calendar | ✅ fully |
| 📅 "Set a meeting with Ramesh tomorrow 5pm" | Adds a calendar event | ✅ fully |
| ⏰ "Remind me to call the bank at 6" | Local notification | ✅ fully |
| 📇 "Text Ramesh good morning" | Finds Ramesh in contacts, opens WhatsApp with the message prefilled | ⚠️ you tap **Send** |
| 🎙️ Voice notes (English/Hindi/Hinglish) | Recorded → transcribed by Whisper on the server | ✅ |

### Why WhatsApp needs one tap
No app on iOS or Android can silently send a WhatsApp message from your personal
number — WhatsApp forbids it. The maximum any app can do is open WhatsApp with the
message pre-typed; you tap Send. That's exactly what this app does (via the
`wa.me` deep link). Fully-automatic sending requires a separate WhatsApp Business
number (handled by the server side of this project), not the user's own number.

## Prerequisites
- Node.js installed.
- The backend running (this repo's server) and reachable over HTTPS. Set its URL
  and token in `src/config.js`.
- The server's `.env` must contain `APP_TOKEN` set to the SAME value as
  `APP_TOKEN` in `src/config.js`.

## Run it (test on a real phone — easiest)
```bash
cd mobile
npm install
npx expo start
```
- Install **Expo Go** from the App Store / Play Store on your phone.
- **Android:** scan the QR code with Expo Go.
- **iOS:** scan the QR with the Camera app → opens in Expo Go.
- Grant the permission prompts (contacts, calendar, notifications, mic).

## Build a standalone APK (Android) for the client
```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```
This produces a downloadable `.apk`. For iOS, `eas build -p ios` (needs an Apple
Developer account) or use TestFlight.

## Config
Edit `src/config.js`:
```js
export const BACKEND_URL = 'https://<your-server>';
export const APP_TOKEN   = '<must match server .env APP_TOKEN>';
```
