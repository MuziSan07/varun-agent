// -----------------------------------------------------------------------------
// Varun Assistant — Flutter app (Android + iOS).
//
// Same behaviour as the React Native version: user types or speaks -> backend
// (Claude) interprets into ONE action -> the app performs it on-device using the
// user's permissions. Keys live on the server; the app only holds APP_TOKEN.
// -----------------------------------------------------------------------------
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';

import 'api.dart';
import 'actions.dart';
import 'settings_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const VarunApp());
}

class VarunApp extends StatelessWidget {
  const VarunApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Varun Assistant',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0F1115),
        colorScheme: const ColorScheme.dark(primary: Color(0xFF25D366)),
      ),
      home: const RootScreen(),
    );
  }
}

class RootScreen extends StatefulWidget {
  const RootScreen({super.key});
  @override
  State<RootScreen> createState() => _RootScreenState();
}

class _RootScreenState extends State<RootScreen> {
  int _tab = 0;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: const [ChatScreen(), SettingsScreen()],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _tab,
        backgroundColor: const Color(0xFF171A21),
        selectedItemColor: const Color(0xFF25D366),
        unselectedItemColor: const Color(0xFF7B8494),
        onTap: (i) => setState(() => _tab = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.chat_bubble_outline), label: 'Chat'),
          BottomNavigationBarItem(icon: Icon(Icons.settings_outlined), label: 'Settings'),
        ],
      ),
    );
  }
}

class _Msg {
  final String role; // 'user' | 'bot'
  final String text;
  _Msg(this.role, this.text);
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _messages = <_Msg>[
    _Msg('bot',
        'Hi! I\'m your assistant 👋\nTry:\n• "Text Ramesh good morning"\n• "Set a meeting with Ramesh tomorrow 5pm"\n• "How many meetings today?"\n• "Who emailed me today?"\n• "Email Ramesh that the order shipped"\n• "Note: client wants blue packaging"'),
  ];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _recorder = AudioRecorder();
  bool _busy = false;
  bool _recording = false;
  String? _recordPath;

  void _add(String role, String text) {
    setState(() => _messages.add(_Msg(role, text)));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  String _cleanFrom(String from) {
    final m = RegExp(r'^\s*"?([^"<]+?)"?\s*<').firstMatch(from);
    return (m != null ? m.group(1)! : from).trim();
  }

  String _fmtTime(DateTime d) {
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final ap = d.hour < 12 ? 'AM' : 'PM';
    return '$h:${d.minute.toString().padLeft(2, '0')} $ap';
  }

  String _fmtDay(DateTime d) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return '${days[d.weekday - 1]}, ${mons[d.month - 1]} ${d.day}';
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    _add('user', text);
    _input.clear();
    setState(() => _busy = true);
    try {
      final result = await Api.interpret(text);
      await _runAction(result);
    } catch (e) {
      _add('bot', '⚠️ Can\'t reach the assistant: $e');
    } finally {
      setState(() => _busy = false);
    }
  }

  void _promptConnectGmail() {
    _add('bot', '📧 To use email, connect your Gmail first (Settings tab).');
  }

  Future<void> _runAction(Map<String, dynamic> result) async {
    if (result['ok'] != true) {
      _add('bot', '⚠️ ${result['error'] ?? 'Something went wrong.'}');
      return;
    }
    final tool = result['tool'] as String?;
    final a = (result['input'] as Map?)?.cast<String, dynamic>() ?? {};
    final data = (result['data'] as Map?)?.cast<String, dynamic>() ?? {};

    if (a['say'] != null) _add('bot', a['say'].toString());

    try {
      switch (tool) {
        case 'send_whatsapp':
          final c = await DeviceActions.findContactPhone(a['contactName'].toString());
          if (!c.found) { _add('bot', 'I couldn\'t find "${a['contactName']}" in your contacts.'); return; }
          if (c.phone == null) { _add('bot', '${c.name} has no phone number saved.'); return; }
          _add('bot', 'Opening WhatsApp to ${c.name}… tap Send to deliver:\n"${a['message']}"');
          await DeviceActions.openWhatsApp(c.phone!, a['message'].toString());
          break;

        case 'create_calendar_event':
          final start = await DeviceActions.createEvent(
              title: a['title'].toString(),
              startISO: a['startISO'].toString(),
              durationMinutes: (a['durationMinutes'] ?? 60) as int);
          _add('bot', '✅ Added to your calendar: "${a['title']}" on ${_fmtDay(start)} at ${_fmtTime(start)}.');
          break;

        case 'set_reminder':
          final when = await DeviceActions.scheduleReminder(
              text: a['text'].toString(), whenISO: a['whenISO'].toString());
          _add('bot', '🔔 Reminder set for ${_fmtDay(when)} at ${_fmtTime(when)}.');
          break;

        case 'query_calendar':
          final events = await DeviceActions.eventsForDate(a['dateISO'].toString());
          if (events.isEmpty) { _add('bot', 'You have no meetings scheduled. 🎉'); return; }
          final lines = events.map((e) => '• ${_fmtTime(e.key)} — ${e.value}').join('\n');
          _add('bot', 'You have ${events.length} meeting${events.length > 1 ? 's' : ''}:\n$lines');
          break;

        case 'save_note':
          final saved = (data['savedNote'] as Map?)?.cast<String, dynamic>();
          if (saved != null) _add('bot', '📝 Noted: "${saved['text']}"');
          break;

        case 'list_notes':
          final notes = (data['notes'] as List?) ?? [];
          if (notes.isEmpty) { _add('bot', 'You have no notes yet. 📭'); return; }
          final lines = notes.asMap().entries
              .map((e) => '${e.key + 1}. ${(e.value as Map)['text']}').join('\n');
          _add('bot', '📝 Your notes:\n$lines');
          break;

        case 'check_email':
          if (data['needsGmail'] == true) { _promptConnectGmail(); return; }
          if (data['emailError'] != null) { _add('bot', '⚠️ ${data['emailError']}'); return; }
          final mails = (data['emails'] as List?) ?? [];
          if (mails.isEmpty) { _add('bot', 'No new emails. 📭'); return; }
          final lines = mails.map((m) => '• ${_cleanFrom((m as Map)['from'].toString())} — ${m['subject']}').join('\n');
          _add('bot', '📧 ${mails.length} recent email${mails.length > 1 ? 's' : ''}:\n$lines');
          break;

        case 'read_email':
          if (data['needsGmail'] == true) { _promptConnectGmail(); return; }
          if (data['emailError'] != null) { _add('bot', '⚠️ ${data['emailError']}'); return; }
          final e = (data['email'] as Map?)?.cast<String, dynamic>();
          if (e == null || e['found'] != true) { _add('bot', 'I couldn\'t find that email.'); return; }
          _add('bot', '📩 From: ${_cleanFrom(e['from'].toString())}\n📌 ${e['subject']}\n\n${e['body'] ?? '(no readable text)'}');
          break;

        case 'send_email':
          if (data['needsGmail'] == true) { _promptConnectGmail(); return; }
          if (data['emailError'] != null) { _add('bot', '⚠️ ${data['emailError']}'); return; }
          if (data['emailSent'] != null) { _add('bot', '📤 Email sent to ${(data['emailSent'] as Map)['to']}.'); return; }
          final r = (data['resolveContactEmail'] as Map?)?.cast<String, dynamic>();
          if (r != null) {
            final c = await DeviceActions.findContactEmail(r['name'].toString());
            if (!c.found) { _add('bot', 'I couldn\'t find "${r['name']}" in your contacts.'); return; }
            if (c.email == null) { _add('bot', '${c.name} has no email saved in your contacts.'); return; }
            final sent = await Api.sendEmail(c.email!, r['subject'].toString(), r['body'].toString());
            _add('bot', sent['ok'] == true ? '📤 Email sent to ${c.name} (${c.email}).' : '⚠️ ${sent['error']}');
          }
          break;

        // 'reply' needs nothing beyond a.say
      }
    } catch (e) {
      _add('bot', '⚠️ $e');
    }
  }

  // ---- Voice: record -> transcribe -> interpret ----------------------------
  Future<void> _toggleRecord() async {
    if (_busy) return;
    try {
      if (_recording) {
        final path = await _recorder.stop();
        setState(() => _recording = false);
        if (path == null) return;
        setState(() => _busy = true);
        final bytes = await File(path).readAsBytes();
        final b64 = base64Encode(bytes);
        final t = await Api.transcribe(b64, mimetype: 'audio/m4a');
        if (t['ok'] != true) { _add('bot', '⚠️ ${t['error']}'); setState(() => _busy = false); return; }
        _add('user', '🎙️ ${t['text']}');
        final result = await Api.interpret(t['text'].toString());
        await _runAction(result);
        setState(() => _busy = false);
      } else {
        if (!await _recorder.hasPermission()) {
          _add('bot', '⚠️ Microphone permission needed.');
          return;
        }
        final dir = await getTemporaryDirectory();
        _recordPath = '${dir.path}/voice.m4a';
        await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: _recordPath!);
        setState(() => _recording = true);
      }
    } catch (e) {
      _add('bot', '⚠️ Voice error: $e');
      setState(() { _recording = false; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          // Header
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
            color: const Color(0xFF171A21),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Text('Varun Assistant',
                    style: TextStyle(color: Color(0xFFE7E9EE), fontSize: 19, fontWeight: FontWeight.bold)),
                SizedBox(height: 2),
                Text('English · हिंदी · Hinglish',
                    style: TextStyle(color: Color(0xFF25D366), fontSize: 12)),
              ],
            ),
          ),
          // Chat
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(14),
              itemCount: _messages.length + (_busy ? 1 : 0),
              itemBuilder: (ctx, i) {
                if (i >= _messages.length) {
                  return const Padding(
                    padding: EdgeInsets.all(8),
                    child: Align(alignment: Alignment.centerLeft, child: SizedBox(
                      width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF25D366)),),),
                  );
                }
                final m = _messages[i];
                final isUser = m.role == 'user';
                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 9),
                    padding: const EdgeInsets.all(11),
                    constraints: BoxConstraints(maxWidth: MediaQuery.of(ctx).size.width * 0.85),
                    decoration: BoxDecoration(
                      color: isUser ? const Color(0xFF25D366) : const Color(0xFF1F2430),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(m.text,
                        style: TextStyle(color: isUser ? const Color(0xFF06281A) : const Color(0xFFE7E9EE), fontSize: 15)),
                  ),
                );
              },
            ),
          ),
          // Input row
          Container(
            padding: const EdgeInsets.all(10),
            color: const Color(0xFF171A21),
            child: Row(
              children: [
                GestureDetector(
                  onTap: _toggleRecord,
                  child: CircleAvatar(
                    radius: 21,
                    backgroundColor: _recording ? const Color(0xFFEF4444) : const Color(0xFF1F2430),
                    child: Icon(_recording ? Icons.stop : Icons.mic, color: Colors.white, size: 20),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _input,
                    style: const TextStyle(color: Color(0xFFE7E9EE)),
                    onSubmitted: (_) => _send(),
                    decoration: InputDecoration(
                      hintText: _recording ? 'Recording… tap stop' : 'Message your assistant…',
                      hintStyle: const TextStyle(color: Color(0xFF7B8494)),
                      filled: true,
                      fillColor: const Color(0xFF0F1115),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: _send,
                  child: const CircleAvatar(
                    radius: 21,
                    backgroundColor: Color(0xFF25D366),
                    child: Icon(Icons.send, color: Color(0xFF06281A), size: 20),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
