// -----------------------------------------------------------------------------
// Backend API client (mirrors the React Native app's src/api.js).
//
// Endpoints (all under /mobile, authed with the X-App-Token header):
//   POST /interpret      { text, nowISO }            -> { ok, tool, input, data? }
//   POST /transcribe     { base64, mimetype, filename } -> { ok, text }
//   POST /send-email     { to, subject, body }       -> { ok }
//   GET  /gmail-status                                -> { ok, configured, connected }
//   GET  /settings/gmail                              -> { ok, hasClientId, ..., redirectUri }
//   POST /settings/gmail { clientId, clientSecret }   -> { ok, ... }
// Plus the browser OAuth entry point: <backend>/auth/google
// -----------------------------------------------------------------------------
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'config.dart';

class Api {
  static Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'X-App-Token': Config.appToken,
      };

  static Future<Map<String, dynamic>> _post(
      String path, Map<String, dynamic> body) async {
    final uri = Uri.parse('${Config.backendUrl}$path');
    http.Response res;
    try {
      res = await http
          .post(uri, headers: _headers, body: jsonEncode(body))
          .timeout(const Duration(seconds: 60));
    } catch (e) {
      throw Exception('Network error: $e');
    }
    // Parse JSON; surface a useful message if the server returned an error page.
    try {
      return jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      final snippet = res.body
          .replaceAll(RegExp(r'<[^>]+>'), ' ')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
      throw Exception('Server ${res.statusCode}: '
          '${snippet.isEmpty ? 'non-JSON response' : snippet.substring(0, snippet.length.clamp(0, 120))}');
    }
  }

  static Future<Map<String, dynamic>> _get(String path) async {
    final uri = Uri.parse('${Config.backendUrl}$path');
    final res = await http
        .get(uri, headers: {'X-App-Token': Config.appToken}).timeout(
            const Duration(seconds: 30));
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  // Interpret a typed/spoken instruction into one structured action.
  static Future<Map<String, dynamic>> interpret(String text) {
    return _post('/mobile/interpret',
        {'text': text, 'nowISO': DateTime.now().toIso8601String()});
  }

  // Transcribe a base64 voice note -> text.
  static Future<Map<String, dynamic>> transcribe(String base64,
      {String mimetype = 'audio/m4a', String filename = 'voice.m4a'}) {
    return _post('/mobile/transcribe',
        {'base64': base64, 'mimetype': mimetype, 'filename': filename});
  }

  // Send an email to a resolved address (after looking up a contact's email).
  static Future<Map<String, dynamic>> sendEmail(
      String to, String subject, String body) {
    return _post('/mobile/send-email',
        {'to': to, 'subject': subject, 'body': body});
  }

  // Gmail connection status.
  static Future<Map<String, dynamic>> gmailStatus() =>
      _get('/mobile/gmail-status');

  // Settings: read masked Gmail credential status + redirect URI.
  static Future<Map<String, dynamic>> getGmailSettings() =>
      _get('/mobile/settings/gmail');

  // Settings: save the client's Google Client ID + Secret.
  static Future<Map<String, dynamic>> saveGmailSettings(
      String clientId, String clientSecret) {
    return _post('/mobile/settings/gmail',
        {'clientId': clientId, 'clientSecret': clientSecret});
  }

  static Future<Map<String, dynamic>> disconnectGmail() =>
      _post('/mobile/settings/gmail/disconnect', {});

  // The URL the app opens in a browser to connect Gmail.
  static String gmailAuthUrl() => '${Config.backendUrl}/auth/google';
}
