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
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { interpret, transcribe, sendEmail, gmailAuthUrl } from './src/api.js';
import {
  findContactPhone, findContactEmail, openWhatsApp, createEvent, eventsForDate, scheduleReminder,
} from './src/actions.js';

// Local-notification handler. Wrapped in try/catch because Expo Go (SDK 53+)
// strips part of the notifications module and logs noisy errors; reminders work
// fully in a real build / dev-client. This keeps the preview clean.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
} catch {
  /* not supported in Expo Go preview — fine */
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDay(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
// "Ramesh Kumar <ramesh@x.com>" -> "Ramesh Kumar"; "a@b.com" -> "a@b.com"
function cleanFrom(from) {
  const m = String(from).match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim();
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AssistantScreen />
    </SafeAreaProvider>
  );
}

function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Hi! I\'m your assistant 👋\nTry:\n• "Text Ramesh good morning"\n• "Set a meeting with Ramesh tomorrow 5pm"\n• "How many meetings today?"\n• "Who emailed me today?"\n• "Email Ramesh that the order shipped"\n• "Note: client wants blue packaging"' },
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

  // Open the server's Google sign-in page in the browser.
  function connectGmail() {
    Linking.openURL(gmailAuthUrl());
  }
  function promptConnectGmail() {
    add('bot', '📧 To use email, connect your Gmail first.');
    Alert.alert(
      'Connect Gmail',
      'Sign in with Google to let the assistant read and send your email.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Connect Gmail', onPress: connectGmail },
      ],
    );
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

      } else if (tool === 'save_note') {
        // Saved on the server; confirmation already shown via a.say.
        const saved = result.data?.savedNote;
        if (saved) add('bot', `📝 Noted: “${saved.text}”`);

      } else if (tool === 'list_notes') {
        const notes = result.data?.notes || [];
        if (!notes.length) { add('bot', 'You have no notes yet. 📭'); return; }
        const lines = notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n');
        add('bot', `📝 Your notes:\n${lines}`);

      } else if (tool === 'check_email') {
        const d = result.data || {};
        if (d.needsGmail) { promptConnectGmail(); return; }
        if (d.emailError) { add('bot', `⚠️ ${d.emailError}`); return; }
        const mails = d.emails || [];
        if (!mails.length) { add('bot', 'No new emails. 📭'); return; }
        const lines = mails.map((m) => `• ${cleanFrom(m.from)} — ${m.subject}`).join('\n');
        add('bot', `📧 ${mails.length} recent email${mails.length > 1 ? 's' : ''}:\n${lines}`);

      } else if (tool === 'send_email') {
        const d = result.data || {};
        if (d.needsGmail) { promptConnectGmail(); return; }
        if (d.emailError) { add('bot', `⚠️ ${d.emailError}`); return; }
        if (d.emailSent) { add('bot', `📤 Email sent to ${d.emailSent.to}.`); return; }
        // Recipient was a NAME — resolve their email from contacts, then send.
        if (d.resolveContactEmail) {
          const { name, subject, body } = d.resolveContactEmail;
          const c = await findContactEmail(name);
          if (!c.found) { add('bot', `I couldn't find "${name}" in your contacts.`); return; }
          if (!c.email) { add('bot', `${c.name} has no email saved in your contacts.`); return; }
          const r = await sendEmail(c.email, subject, body);
          add('bot', r.ok ? `📤 Email sent to ${c.name} (${c.email}).` : `⚠️ ${r.error}`);
        }

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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Varun Assistant</Text>
            <Text style={styles.subtitle}>English · हिंदी · Hinglish</Text>
          </View>
          <TouchableOpacity style={styles.gmailBtn} onPress={connectGmail}>
            <Text style={styles.gmailBtnText}>Connect Gmail</Text>
          </TouchableOpacity>
        </View>
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
        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
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
  header: { paddingBottom: 14, paddingHorizontal: 18, backgroundColor: '#171a21', borderBottomWidth: 1, borderBottomColor: '#2a2f3a' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gmailBtn: { backgroundColor: '#1f2430', borderWidth: 1, borderColor: '#25d366', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  gmailBtnText: { color: '#25d366', fontSize: 12, fontWeight: '600' },
  title: { color: '#e7e9ee', fontSize: 19, fontWeight: '700' },
  subtitle: { color: '#25d366', fontSize: 12, marginTop: 2 },
  chat: { flex: 1 },
  bubble: { maxWidth: '85%', padding: 11, borderRadius: 14, marginBottom: 9 },
  user: { alignSelf: 'flex-end', backgroundColor: '#25d366', borderBottomRightRadius: 3 },
  bot: { alignSelf: 'flex-start', backgroundColor: '#1f2430', borderBottomLeftRadius: 3 },
  userText: { color: '#06281a', fontSize: 15 },
  botText: { color: '#e7e9ee', fontSize: 15 },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 10, backgroundColor: '#171a21', borderTopWidth: 1, borderTopColor: '#2a2f3a' },
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
