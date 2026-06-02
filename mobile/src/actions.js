// -----------------------------------------------------------------------------
// Device-side action executors.
//
// The backend returns ONE action ({tool, input}); these functions carry it out
// using the user's own permissions. Nothing here needs an external API beyond
// what's already on the phone. WhatsApp uses the wa.me deep link (prepare + the
// user taps Send — the only possible way on a personal number).
// -----------------------------------------------------------------------------
import { Linking, Platform } from 'react-native';
import * as Contacts from 'expo-contacts';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';

// ---- Contacts ---------------------------------------------------------------
// Find a contact by (fuzzy) name and return their best phone number.
export async function findContactPhone(name) {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Contacts permission denied.');

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });
  const needle = name.trim().toLowerCase();
  const match =
    data.find((c) => (c.name || '').toLowerCase() === needle) ||
    data.find((c) => (c.name || '').toLowerCase().startsWith(needle)) ||
    data.find((c) => (c.name || '').toLowerCase().includes(needle));

  if (!match) return { found: false };
  const phone = match.phoneNumbers?.[0]?.number;
  if (!phone) return { found: true, name: match.name, phone: null };
  return { found: true, name: match.name, phone };
}

// Normalise a phone to digits for wa.me (strip +, spaces, dashes).
function waNumber(phone) {
  return String(phone).replace(/[^\d]/g, '');
}

// ---- WhatsApp (prepare + user taps send) ------------------------------------
export async function openWhatsApp(phone, message) {
  const num = waNumber(phone);
  const url = `whatsapp://send?phone=${num}&text=${encodeURIComponent(message)}`;
  const fallback = `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
  const canOpen = await Linking.canOpenURL(url).catch(() => false);
  await Linking.openURL(canOpen ? url : fallback);
}

// ---- Calendar ---------------------------------------------------------------
async function getDefaultCalendarId() {
  if (Platform.OS === 'ios') {
    const def = await Calendar.getDefaultCalendarAsync().catch(() => null);
    if (def?.id) return def.id;
  }
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = cals.find((c) => c.allowsModifications);
  return (writable || cals[0])?.id;
}

export async function createEvent({ title, startISO, durationMinutes = 60 }) {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') throw new Error('Calendar permission denied.');

  const calendarId = await getDefaultCalendarId();
  if (!calendarId) throw new Error('No writable calendar found on this device.');

  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const id = await Calendar.createEventAsync(calendarId, {
    title,
    startDate: start,
    endDate: end,
    timeZone: undefined,
  });
  return { id, start, end };
}

export async function eventsForDate(dateISO) {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') throw new Error('Calendar permission denied.');

  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = cals.map((c) => c.id);
  const day = new Date(dateISO);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
  const events = await Calendar.getEventsAsync(ids, start, end);
  return events
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .map((e) => ({
      title: e.title,
      start: new Date(e.startDate),
    }));
}

// ---- Reminders (local notifications) ----------------------------------------
export async function scheduleReminder({ text, whenISO }) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Notifications permission denied.');

  const when = new Date(whenISO);
  const secs = Math.max(1, Math.round((when.getTime() - Date.now()) / 1000));
  await Notifications.scheduleNotificationAsync({
    content: { title: '⏰ Reminder', body: text, sound: true },
    trigger: { seconds: secs },
  });
  return { when };
}
