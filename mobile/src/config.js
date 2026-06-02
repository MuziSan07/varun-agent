// -----------------------------------------------------------------------------
// App configuration.
//
// BACKEND_URL points at the same DigitalOcean server that powers the WhatsApp
// agent. The app sends the user's text/voice there; Claude interprets it and the
// app performs the action on-device using the user's permissions.
//
// APP_TOKEN must match APP_TOKEN in the server's .env.
// -----------------------------------------------------------------------------
export const BACKEND_URL = 'https://206.189.207.59.nip.io';
export const APP_TOKEN = 'varun-app-7h2x9q'; // must equal server .env APP_TOKEN
