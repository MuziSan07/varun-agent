// -----------------------------------------------------------------------------
// Varun Assistant — mobile app (Expo, iOS + Android).
//
// Flow: user types or speaks -> backend (Claude) interprets into ONE action ->
// the app executes it ON-DEVICE using the user's permissions:
//   send_whatsapp        -> find contact, open WhatsApp with text prefilled
//   create_calendar_event-> add event to the device calendar
//   set_reminder         -> schedule a local notification
//   query_calendar       -> read the day's events and show them
//   reply                -> just show the assistant's message
//
// Keys live on the server; the app only holds APP_TOKEN.
// -----------------------------------------------------------------------------
import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';

import { interpret, transcribe } from './src/api.js';
import {
  findContactPhone, openWhatsApp, createEvent, eventsForDate, scheduleReminder,
} from './src/actions.js';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDay(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function App() {
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Hi! I\'m your assistant 👋\nTry: "Text Ramesh good morning", "Set a meeting with Ramesh tomorrow 5pm", or "How many meetings today?"' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  function add(role, text) {
    setMessages((m) => [...m, { role, text }]);
  }

  // ---- Execute the action returned by the backend ---------------------------
  async function runAction(result) {
    if (!result.ok) { add('bot', `⚠️ ${result.error || 'Something went wrong.'}`); return; }
    const { tool, input: a } = result;

    // Always show the assistant's spoken confirmation first.
    if (a.say) add('bot', a.say);

    try {
      if (tool === 'send_whatsapp') {
        const c = await findContactPhone(a.contactName);
        if (!c.found) { add('bot', `I couldn't find "${a.contactName}" in your contacts.`); return; }
        if (!c.phone) { add('bot', `${c.name} has no phone number saved.`); return; }
        add('bot', `Opening WhatsApp to ${c.name}… tap Send to deliver:\n“${a.message}”`);
        await openWhatsApp(c.phone, a.message);

      } else if (tool === 'create_calendar_event') {
        const { start } = await createEvent({
          title: a.title, startISO: a.startISO, durationMinutes: a.durationMinutes || 60,
        });
        add('bot', `✅ Added to your calendar: “${a.title}” on ${fmtDay(start)} at ${fmtTime(start)}.`);

      } else if (tool === 'set_reminder') {
        const { when } = await scheduleReminder({ text: a.text, whenISO: a.whenISO });
        add('bot', `🔔 Reminder set for ${fmtDay(when)} at ${fmtTime(when)}.`);

      } else if (tool === 'query_calendar') {
        const events = await eventsForDate(a.dateISO);
        if (!events.length) { add('bot', 'You have no meetings scheduled. 🎉'); return; }
        const lines = events.map((e) => `• ${fmtTime(e.start)} — ${e.title}`).join('\n');
        add('bot', `You have ${events.length} meeting${events.length > 1 ? 's' : ''}:\n${lines}`);

      } // 'reply' needs nothing beyond a.say
    } catch (err) {
      add('bot', `⚠️ ${err.message}`);
    }
  }

  // ---- Text send ------------------------------------------------------------
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    add('user', text);
    setInput('');
    setBusy(true);
    try {
      const result = await interpret(text);
      await runAction(result);
    } catch (err) {
      add('bot', `⚠️ Can't reach the assistant: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ---- Voice: record -> transcribe -> interpret -----------------------------
  async function toggleRecord() {
    if (busy) return;
    try {
      if (recording) {
        setBusy(true);
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        const base64 = await uriToBase64(uri);
        const t = await transcribe(base64);
        if (!t.ok) { add('bot', `⚠️ ${t.error}`); setBusy(false); return; }
        add('user', `🎙️ ${t.text}`);
        const result = await interpret(t.text);
        await runAction(result);
        setBusy(false);
      } else {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted) { Alert.alert('Microphone needed', 'Please allow microphone access.'); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        setRecording(rec);
      }
    } catch (err) {
      add('bot', `⚠️ Voice error: ${err.message}`);
      setRecording(null);
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Varun Assistant</Text>
        <Text style={styles.subtitle}>English · हिंदी · Hinglish</Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.chat} contentContainerStyle={{ padding: 14 }}>
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.user : styles.bot]}>
            <Text style={m.role === 'user' ? styles.userText : styles.botText}>{m.text}</Text>
          </View>
        ))}
        {busy && <ActivityIndicator color="#25d366" style={{ marginTop: 8 }} />}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TouchableOpacity style={[styles.mic, recording && styles.micActive]} onPress={toggleRecord}>
            <Text style={styles.micIcon}>{recording ? '⏹️' : '🎙️'}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={recording ? 'Recording… tap ⏹️ to stop' : 'Message your assistant…'}
            placeholderTextColor="#7b8494"
            onSubmitEditing={send}
            editable={!recording}
            returnKeyType="send"
          />
          <TouchableOpacity style={styles.send} onPress={send} disabled={busy}>
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1115' },
  header: { paddingTop: 56, paddingBottom: 14, paddingHorizontal: 18, backgroundColor: '#171a21', borderBottomWidth: 1, borderBottomColor: '#2a2f3a' },
  title: { color: '#e7e9ee', fontSize: 19, fontWeight: '700' },
  subtitle: { color: '#25d366', fontSize: 12, marginTop: 2 },
  chat: { flex: 1 },
  bubble: { maxWidth: '85%', padding: 11, borderRadius: 14, marginBottom: 9 },
  user: { alignSelf: 'flex-end', backgroundColor: '#25d366', borderBottomRightRadius: 3 },
  bot: { alignSelf: 'flex-start', backgroundColor: '#1f2430', borderBottomLeftRadius: 3 },
  userText: { color: '#06281a', fontSize: 15 },
  botText: { color: '#e7e9ee', fontSize: 15 },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#171a21', borderTopWidth: 1, borderTopColor: '#2a2f3a' },
  input: { flex: 1, backgroundColor: '#0f1115', color: '#e7e9ee', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, marginHorizontal: 8, borderWidth: 1, borderColor: '#2a2f3a' },
  mic: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1f2430', alignItems: 'center', justifyContent: 'center' },
  micActive: { backgroundColor: '#ef4444' },
  micIcon: { fontSize: 18 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#25d366', alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#06281a', fontSize: 18, fontWeight: '700' },
});

// Read a recording file URI into base64 for upload.
async function uriToBase64(uri) {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
