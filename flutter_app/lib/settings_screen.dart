// -----------------------------------------------------------------------------
// Settings screen (mirrors the RN app's SettingsScreen.js).
//
// Lets the client manage their own Gmail (Google OAuth) Client ID + Secret
// without server access. Values are stored on the server; the app only shows a
// MASKED id and never reads the secret back.
// -----------------------------------------------------------------------------
import 'package:flutter/material.dart';
import 'api.dart';
import 'actions.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, dynamic>? _status;
  final _clientId = TextEditingController();
  final _clientSecret = TextEditingController();
  bool _busy = false;
  String _msg = '';

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final s = await Api.getGmailSettings();
      setState(() => _status = s);
    } catch (e) {
      setState(() => _msg = "Couldn't load settings: $e");
    }
  }

  Future<void> _save() async {
    if (_clientId.text.trim().isEmpty) {
      setState(() => _msg = 'Enter the Client ID.');
      return;
    }
    setState(() { _busy = true; _msg = ''; });
    try {
      await Api.saveGmailSettings(_clientId.text.trim(), _clientSecret.text.trim());
      _clientId.clear();
      _clientSecret.clear();
      setState(() => _msg = '✅ Saved. Now tap "Connect Gmail".');
      await _refresh();
    } catch (e) {
      setState(() => _msg = '⚠️ $e');
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _connect() async {
    if (_status?['hasClientId'] != true || _status?['hasClientSecret'] != true) {
      setState(() => _msg = 'Add and save your Client ID and Secret first.');
      return;
    }
    await DeviceActions.openUrl(Api.gmailAuthUrl());
  }

  Future<void> _disconnect() async {
    setState(() => _busy = true);
    try {
      await Api.disconnectGmail();
      setState(() => _msg = 'Disconnected.');
      await _refresh();
    } catch (e) {
      setState(() => _msg = '⚠️ $e');
    } finally {
      setState(() => _busy = false);
    }
  }

  InputDecoration _dec(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFF5B6472)),
        filled: true,
        fillColor: const Color(0xFF0F1115),
        contentPadding: const EdgeInsets.all(11),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF2A2F3A))),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF2A2F3A))),
      );

  @override
  Widget build(BuildContext context) {
    final s = _status;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Settings', style: TextStyle(color: Color(0xFFE7E9EE), fontSize: 22, fontWeight: FontWeight.bold)),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF171A21),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFF2A2F3A)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('📧 Gmail', style: TextStyle(color: Color(0xFFE7E9EE), fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(
                    s == null
                        ? 'Loading…'
                        : '${s['hasClientId'] == true ? '✅ Client ID set' : '❌ No Client ID'}   ·   ${s['connected'] == true ? '🟢 Connected' : '⚪ Not connected'}',
                    style: const TextStyle(color: Color(0xFF97A0B0), fontSize: 13),
                  ),
                  if (s?['clientIdMasked'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('ID: ${s!['clientIdMasked']}', style: const TextStyle(color: Color(0xFF5B6472), fontSize: 12)),
                    ),
                  const SizedBox(height: 12),
                  const Text('Google Client ID', style: TextStyle(color: Color(0xFF97A0B0), fontSize: 12)),
                  const SizedBox(height: 5),
                  TextField(controller: _clientId, style: const TextStyle(color: Color(0xFFE7E9EE)), decoration: _dec('xxxx.apps.googleusercontent.com')),
                  const SizedBox(height: 12),
                  const Text('Google Client Secret', style: TextStyle(color: Color(0xFF97A0B0), fontSize: 12)),
                  const SizedBox(height: 5),
                  TextField(controller: _clientSecret, obscureText: true, style: const TextStyle(color: Color(0xFFE7E9EE)), decoration: _dec('GOCSPX-…')),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _busy ? null : _save,
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF25D366)),
                      child: const Text('Save credentials', style: TextStyle(color: Color(0xFF06281A), fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _busy ? null : _connect,
                          style: OutlinedButton.styleFrom(side: const BorderSide(color: Color(0xFF25D366))),
                          child: const Text('Connect Gmail', style: TextStyle(color: Color(0xFF25D366))),
                        ),
                      ),
                      if (s?['connected'] == true) ...[
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: _busy ? null : _disconnect,
                            style: OutlinedButton.styleFrom(side: const BorderSide(color: Color(0xFFEF4444))),
                            child: const Text('Disconnect', style: TextStyle(color: Color(0xFFEF4444))),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (_msg.isNotEmpty)
                    Padding(padding: const EdgeInsets.only(top: 12), child: Text(_msg, style: const TextStyle(color: Color(0xFFE7E9EE), fontSize: 13))),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF171A21),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFF2A2F3A)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('How to get these (one-time)', style: TextStyle(color: Color(0xFFE7E9EE), fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  const Text(
                    '1. console.cloud.google.com → create a project.\n'
                    '2. APIs & Services → Library → enable "Gmail API".\n'
                    '3. OAuth consent → External → add yourself as a Test user.\n'
                    '4. Credentials → Create → OAuth client ID → Web application.\n'
                    '5. Add this Authorized redirect URI:',
                    style: TextStyle(color: Color(0xFF97A0B0), fontSize: 13, height: 1.5),
                  ),
                  const SizedBox(height: 8),
                  SelectableText(s?['redirectUri']?.toString() ?? '…',
                      style: const TextStyle(color: Color(0xFF25D366), fontSize: 12, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  const Text('6. Copy the Client ID + Secret here and Save.',
                      style: TextStyle(color: Color(0xFF97A0B0), fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
