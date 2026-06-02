// -----------------------------------------------------------------------------
// Settings screen.
//
// Lets the client manage their own secrets — currently the Gmail (Google OAuth)
// Client ID + Secret — without touching the server. Values are stored on the
// server; the app only ever shows a MASKED id and never reads the secret back.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking,
} from 'react-native';
import { getGmailSettings, saveGmailSettings, disconnectGmail, gmailAuthUrl } from './api.js';

export default function SettingsScreen({ insets }) {
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function refresh() {
    try {
      const s = await getGmailSettings();
      setStatus(s);
    } catch (err) {
      setMsg(`Couldn't load settings: ${err.message}`);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!clientId.trim()) { setMsg('Enter the Client ID.'); return; }
    setBusy(true); setMsg('');
    try {
      await saveGmailSettings(clientId.trim(), clientSecret.trim());
      setClientId(''); setClientSecret('');
      setMsg('✅ Saved. Now tap "Connect Gmail" below.');
      await refresh();
    } catch (err) {
      setMsg(`⚠️ ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    if (!status?.hasClientId || !status?.hasClientSecret) {
      Alert.alert('Add credentials first', 'Enter and save your Client ID and Secret before connecting.');
      return;
    }
    Linking.openURL(gmailAuthUrl());
  }

  async function disconnect() {
    setBusy(true);
    try { await disconnectGmail(); setMsg('Disconnected.'); await refresh(); }
    catch (err) { setMsg(`⚠️ ${err.message}`); }
    finally { setBusy(false); }
  }

  function copyRedirect() {
    // Show it so the user can copy it into Google Cloud Console.
    Alert.alert('Redirect URI', status?.redirectUri || '', [{ text: 'OK' }]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 18, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}>
      <Text style={styles.h1}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.h2}>📧 Gmail</Text>
        <Text style={styles.status}>
          {status
            ? `${status.hasClientId ? '✅ Client ID set' : '❌ No Client ID'}` +
              `   ·   ${status.connected ? '🟢 Connected' : '⚪ Not connected'}`
            : 'Loading…'}
        </Text>
        {status?.clientIdMasked ? <Text style={styles.masked}>ID: {status.clientIdMasked}</Text> : null}

        <Text style={styles.label}>Google Client ID</Text>
        <TextInput
          style={styles.input}
          value={clientId}
          onChangeText={setClientId}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          placeholderTextColor="#5b6472"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Google Client Secret</Text>
        <TextInput
          style={styles.input}
          value={clientSecret}
          onChangeText={setClientSecret}
          placeholder="GOCSPX-…"
          placeholderTextColor="#5b6472"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={save} disabled={busy}>
          <Text style={styles.primaryText}>Save credentials</Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, styles.ghost, { flex: 1 }]} onPress={connect} disabled={busy}>
            <Text style={styles.ghostText}>Connect Gmail</Text>
          </TouchableOpacity>
          {status?.connected ? (
            <TouchableOpacity style={[styles.btn, styles.danger, { flex: 1 }]} onPress={disconnect} disabled={busy}>
              <Text style={styles.dangerText}>Disconnect</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>How to get these (one-time)</Text>
        <Text style={styles.help}>
          1. Go to console.cloud.google.com → create a project.{'\n'}
          2. APIs &amp; Services → Library → enable “Gmail API”.{'\n'}
          3. OAuth consent screen → External → add yourself as a Test user.{'\n'}
          4. Credentials → Create → OAuth client ID → Web application.{'\n'}
          5. Add this Authorized redirect URI:
        </Text>
        <TouchableOpacity onPress={copyRedirect}>
          <Text style={styles.redirect}>{status?.redirectUri || '…'}  (tap to view)</Text>
        </TouchableOpacity>
        <Text style={styles.help}>6. Copy the Client ID + Secret here and Save.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1115' },
  h1: { color: '#e7e9ee', fontSize: 22, fontWeight: '700', marginBottom: 14 },
  card: { backgroundColor: '#171a21', borderWidth: 1, borderColor: '#2a2f3a', borderRadius: 14, padding: 16, marginBottom: 16 },
  h2: { color: '#e7e9ee', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  status: { color: '#97a0b0', fontSize: 13, marginBottom: 4 },
  masked: { color: '#5b6472', fontSize: 12, marginBottom: 8 },
  label: { color: '#97a0b0', fontSize: 12, marginTop: 12, marginBottom: 5 },
  input: { backgroundColor: '#0f1115', color: '#e7e9ee', borderRadius: 8, padding: 11, fontSize: 14, borderWidth: 1, borderColor: '#2a2f3a' },
  btn: { borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  primary: { backgroundColor: '#25d366' },
  primaryText: { color: '#06281a', fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', gap: 10 },
  ghost: { backgroundColor: '#1f2430', borderWidth: 1, borderColor: '#25d366' },
  ghostText: { color: '#25d366', fontWeight: '600', fontSize: 14 },
  danger: { backgroundColor: '#1f2430', borderWidth: 1, borderColor: '#ef4444' },
  dangerText: { color: '#ef4444', fontWeight: '600', fontSize: 14 },
  msg: { color: '#e7e9ee', fontSize: 13, marginTop: 12 },
  help: { color: '#97a0b0', fontSize: 13, lineHeight: 20 },
  redirect: { color: '#25d366', fontSize: 12, marginVertical: 8, fontWeight: '600' },
});
