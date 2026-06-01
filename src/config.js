// -----------------------------------------------------------------------------
// Centralized configuration.
//
// Design goals (per CLAUDE.md):
//  - The app MUST NOT crash on startup with empty keys.
//  - Each service can be probed for "is it configured?" and report EXACTLY which
//    variable is missing.
//  - SANDBOX vs LIVE is a first-class, runtime-flippable toggle (default SANDBOX).
// -----------------------------------------------------------------------------
import dotenv from 'dotenv';

// `override: true` makes the local .env the source of truth even if a variable of
// the same name already exists in the ambient shell environment. Without this, a
// stray ANTHROPIC_API_KEY (or similar) inherited from the parent process would
// silently shadow the value you put in .env. In the cloud you typically set real
// environment variables and ship no .env file, so this is a harmless no-op there.
dotenv.config({ override: true });

// Runtime mode is held in memory so the dashboard toggle can change it without a
// restart. It is initialised from the env var and persisted via the store.
let runtimeMode = (process.env.MODE || 'SANDBOX').toUpperCase() === 'LIVE'
  ? 'LIVE'
  : 'SANDBOX';

export function getMode() {
  return runtimeMode;
}

export function setMode(mode) {
  runtimeMode = String(mode).toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX';
  return runtimeMode;
}

export function isSandbox() {
  return runtimeMode === 'SANDBOX';
}

// Plain helper: read an env var, treating empty string as "missing".
function env(name) {
  const v = process.env[name];
  return v === undefined || v === '' ? null : v;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dashboardToken: env('DASHBOARD_TOKEN'),
  publicBaseUrl: env('PUBLIC_BASE_URL'),
  // Webhook signature checking is OPT-IN. Recommended ON in production, but off by
  // default so local/sandbox testing through tunnels never fails on a URL mismatch
  // (http/https, trailing path, changing ngrok host).
  enforceTwilioSignature: (env('TWILIO_VALIDATE_SIGNATURE') || 'false').toLowerCase() === 'true',

  owner: {
    whatsapp: env('OWNER_WHATSAPP_NUMBER'),
    name: env('OWNER_NAME') || 'the client',
  },

  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL') || 'claude-sonnet-4-6',
  },

  openai: {
    apiKey: env('OPENAI_API_KEY'),
    transcribeModel: env('OPENAI_TRANSCRIBE_MODEL') || 'whisper-1',
  },

  twilio: {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    whatsappSandboxFrom: env('TWILIO_WHATSAPP_SANDBOX_FROM') || 'whatsapp:+14155238886',
    whatsappLiveFrom: env('TWILIO_WHATSAPP_LIVE_FROM'),
    voiceFrom: env('TWILIO_VOICE_FROM'),
    templateSid: env('TWILIO_TEMPLATE_SID'),
  },

  uber: {
    accessToken: env('UBER_ACCESS_TOKEN'),
    sandboxBaseUrl: env('UBER_SANDBOX_BASE_URL') || 'https://sandbox-api.uber.com',
    liveBaseUrl: env('UBER_LIVE_BASE_URL') || 'https://api.uber.com',
  },
};

// Which WhatsApp "from" address to use given the current mode.
export function whatsappFrom() {
  return isSandbox()
    ? config.twilio.whatsappSandboxFrom
    : config.twilio.whatsappLiveFrom;
}

export function uberBaseUrl() {
  return isSandbox() ? config.uber.sandboxBaseUrl : config.uber.liveBaseUrl;
}

// -----------------------------------------------------------------------------
// Per-service "is it configured?" descriptors. The dashboard uses `requires` to
// tell the developer EXACTLY which variable is blank.
// -----------------------------------------------------------------------------
const REQUIREMENTS = {
  claude: [['ANTHROPIC_API_KEY', config.anthropic.apiKey]],
  openai: [['OPENAI_API_KEY', config.openai.apiKey]],
  twilio: [
    ['TWILIO_ACCOUNT_SID', config.twilio.accountSid],
    ['TWILIO_AUTH_TOKEN', config.twilio.authToken],
  ],
  uber: [['UBER_ACCESS_TOKEN', config.uber.accessToken]],
};

// Returns { configured: boolean, missing: string[] } for a service key.
export function serviceStatus(service) {
  const reqs = REQUIREMENTS[service];
  if (!reqs) return { configured: false, missing: ['UNKNOWN_SERVICE'] };
  const missing = reqs.filter(([, value]) => !value).map(([name]) => name);
  return { configured: missing.length === 0, missing };
}

// Throw a clear, actionable error if a service is used while unconfigured.
export function assertConfigured(service) {
  const { configured, missing } = serviceStatus(service);
  if (!configured) {
    throw new Error(
      `Service "${service}" is not configured. Missing in .env: ${missing.join(', ')}`,
    );
  }
}
