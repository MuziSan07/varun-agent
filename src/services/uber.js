// -----------------------------------------------------------------------------
// Uber client — ride booking.
//
// Uses the Uber REST API. In SANDBOX mode it talks to the Uber sandbox base URL
// (no real ride is dispatched). All calls fail gracefully and are logged.
//
// NOTE: Uber's Rides API access is gated and the exact product/endpoint set
// varies by account. This module implements the standard request flow
// (estimate -> request) and is written so the destination/pickup are passed as
// coordinates. If your Uber account exposes a different surface, adjust the
// endpoints here — nothing else in the codebase depends on the internals.
// -----------------------------------------------------------------------------
import { config, assertConfigured, uberBaseUrl, isSandbox } from '../config.js';
import { logger } from '../logger.js';

function authHeaders() {
  return {
    Authorization: `Bearer ${config.uber.accessToken}`,
    'Content-Type': 'application/json',
    'Accept-Language': 'en_US',
  };
}

async function uberFetch(pathName, options = {}) {
  const url = `${uberBaseUrl()}${pathName}`;
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    const err = new Error(`Uber API error: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Get fare/time estimates between two coordinate pairs.
export async function getEstimate({ startLat, startLng, endLat, endLng }) {
  assertConfigured('uber');
  return uberFetch(
    `/v1.2/estimates/price?start_latitude=${startLat}&start_longitude=${startLng}` +
      `&end_latitude=${endLat}&end_longitude=${endLng}`,
  );
}

// Request a ride. In SANDBOX, the request hits the sandbox host so nothing real
// is dispatched. Returns { ok, requestId?, status?, detail?, error? }.
export async function requestRide({ startLat, startLng, endLat, endLng, productId, pickupName, destName }) {
  try {
    assertConfigured('uber');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  try {
    const body = {
      start_latitude: startLat,
      start_longitude: startLng,
      end_latitude: endLat,
      end_longitude: endLng,
    };
    if (productId) body.product_id = productId;

    const res = await uberFetch('/v1.2/requests', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    logger.info('uber', 'Ride requested', {
      requestId: res.request_id,
      status: res.status,
      sandbox: isSandbox(),
    });
    return {
      ok: true,
      requestId: res.request_id,
      status: res.status,
      detail: `Ride ${isSandbox() ? '(SANDBOX) ' : ''}from "${pickupName || 'pickup'}" to ` +
        `"${destName || 'destination'}" — status: ${res.status}.`,
    };
  } catch (err) {
    logger.error('uber', 'Ride request failed', { error: err.message, body: err.body });
    return { ok: false, error: err.message };
  }
}

export async function testConnection() {
  try {
    assertConfigured('uber');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    // /v1.2/me is the lightest authenticated read.
    const me = await uberFetch('/v1.2/me');
    const who = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.uuid || 'authenticated user';
    return { ok: true, detail: `Authenticated as ${who}. Mode: ${isSandbox() ? 'SANDBOX' : 'LIVE'}.` };
  } catch (err) {
    logger.error('uber', 'Test connection failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}
