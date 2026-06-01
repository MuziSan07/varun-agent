// -----------------------------------------------------------------------------
// Geocoding: turn a place name ("Mumbai airport") into coordinates for Uber.
//
// Uses OpenStreetMap Nominatim — keyless and free. Per their usage policy we set
// a descriptive User-Agent and only make low-volume, on-demand requests. Swap
// for Google/Mapbox if you need higher limits (set a key + change this file).
// -----------------------------------------------------------------------------
import { logger } from '../logger.js';

export async function geocode(place) {
  if (!place) return { ok: false, error: 'No place provided.' };
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(place);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'whatsapp-ai-assistant/1.0 (personal assistant)' },
    });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const data = await res.json();
    if (!data.length) return { ok: false, error: `Could not find a location for "${place}".` };
    return {
      ok: true,
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      label: data[0].display_name,
    };
  } catch (err) {
    logger.error('geocode', 'Lookup failed', { place, error: err.message });
    return { ok: false, error: err.message };
  }
}
