// -----------------------------------------------------------------------------
// App configuration.
//
// The Flutter app is a CLIENT of the same backend that powers the React Native
// app and the WhatsApp agent. The "brain" (Claude), Gmail OAuth, and voice
// transcription all live on the server; the app just sends text/voice and
// performs the returned action on-device using the user's permissions.
//
// BACKEND_URL  -> the deployed server (DigitalOcean droplet, HTTPS).
// APP_TOKEN    -> must match APP_TOKEN in the server's .env.
// -----------------------------------------------------------------------------
class Config {
  static const String backendUrl = 'https://206.189.207.59.nip.io';
  static const String appToken = 'varun-app-7h2x9q';
}
