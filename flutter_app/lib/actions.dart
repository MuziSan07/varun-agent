// -----------------------------------------------------------------------------
// Device-side action executors (mirrors the React Native app's src/actions.js).
//
// The backend returns ONE action; these functions carry it out using the user's
// own permissions. WhatsApp uses the wa.me deep link (prepare + the user taps
// Send — the only possible way on a personal number).
// -----------------------------------------------------------------------------
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:device_calendar/device_calendar.dart' hide Event;
import 'package:device_calendar/device_calendar.dart' as cal show Event;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:timezone/timezone.dart' as tz;
import 'package:timezone/data/latest.dart' as tzdata;

class ContactMatch {
  final bool found;
  final String? name;
  final String? phone;
  final String? email;
  ContactMatch({required this.found, this.name, this.phone, this.email});
}

class DeviceActions {
  static final _notifications = FlutterLocalNotificationsPlugin();
  static final _calendar = DeviceCalendarPlugin();
  static bool _notifReady = false;

  // ---- Notifications setup -------------------------------------------------
  static Future<void> initNotifications() async {
    if (_notifReady) return;
    tzdata.initializeTimeZones();
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings();
    await _notifications.initialize(
        const InitializationSettings(android: android, iOS: ios));
    _notifReady = true;
  }

  // ---- Contacts ------------------------------------------------------------
  static Future<List<Contact>> _allContacts() async {
    if (!await FlutterContacts.requestPermission()) {
      throw Exception('Contacts permission denied.');
    }
    return FlutterContacts.getContacts(
        withProperties: true, withPhoto: false);
  }

  static Contact? _fuzzy(List<Contact> contacts, String name) {
    final n = name.trim().toLowerCase();
    for (final c in contacts) {
      if (c.displayName.toLowerCase() == n) return c;
    }
    for (final c in contacts) {
      if (c.displayName.toLowerCase().startsWith(n)) return c;
    }
    for (final c in contacts) {
      if (c.displayName.toLowerCase().contains(n)) return c;
    }
    return null;
  }

  static Future<ContactMatch> findContactPhone(String name) async {
    final match = _fuzzy(await _allContacts(), name);
    if (match == null) return ContactMatch(found: false);
    final phone = match.phones.isNotEmpty ? match.phones.first.number : null;
    return ContactMatch(found: true, name: match.displayName, phone: phone);
  }

  static Future<ContactMatch> findContactEmail(String name) async {
    final match = _fuzzy(await _allContacts(), name);
    if (match == null) return ContactMatch(found: false);
    final email = match.emails.isNotEmpty ? match.emails.first.address : null;
    return ContactMatch(found: true, name: match.displayName, email: email);
  }

  // ---- WhatsApp (prepare + user taps send) ---------------------------------
  static Future<void> openWhatsApp(String phone, String message) async {
    final num = phone.replaceAll(RegExp(r'[^\d]'), '');
    final wa = Uri.parse('whatsapp://send?phone=$num&text=${Uri.encodeComponent(message)}');
    final web = Uri.parse('https://wa.me/$num?text=${Uri.encodeComponent(message)}');
    if (await canLaunchUrl(wa)) {
      await launchUrl(wa, mode: LaunchMode.externalApplication);
    } else {
      await launchUrl(web, mode: LaunchMode.externalApplication);
    }
  }

  // ---- Calendar ------------------------------------------------------------
  static Future<String?> _writableCalendarId() async {
    final perm = await _calendar.hasPermissions();
    if (perm.data != true) {
      final req = await _calendar.requestPermissions();
      if (req.data != true) throw Exception('Calendar permission denied.');
    }
    final cals = await _calendar.retrieveCalendars();
    final list = cals.data ?? [];
    final writable = list.firstWhere(
      (c) => c.isReadOnly == false,
      orElse: () => list.isNotEmpty ? list.first : (throw Exception('No calendar found.')),
    );
    return writable.id;
  }

  static Future<DateTime> createEvent(
      {required String title, required String startISO, int durationMinutes = 60}) async {
    final calId = await _writableCalendarId();
    final start = DateTime.parse(startISO);
    final end = start.add(Duration(minutes: durationMinutes));
    final location = tz.local;
    final event = cal.Event(calId,
        title: title,
        start: tz.TZDateTime.from(start, location),
        end: tz.TZDateTime.from(end, location));
    final res = await _calendar.createOrUpdateEvent(event);
    if (res?.isSuccess != true) {
      throw Exception(res?.errors.map((e) => e.errorMessage).join(', ') ?? 'Calendar write failed.');
    }
    return start;
  }

  static Future<List<MapEntry<DateTime, String>>> eventsForDate(String dateISO) async {
    final calId = await _writableCalendarId();
    final cals = await _calendar.retrieveCalendars();
    final ids = (cals.data ?? []).map((c) => c.id!).toList();
    final day = DateTime.parse(dateISO);
    final start = DateTime(day.year, day.month, day.day, 0, 0, 0);
    final end = DateTime(day.year, day.month, day.day, 23, 59, 59);
    final out = <MapEntry<DateTime, String>>[];
    for (final id in ids.isEmpty ? [calId!] : ids) {
      final res = await _calendar.retrieveEvents(
          id, RetrieveEventsParams(startDate: start, endDate: end));
      for (final e in res.data ?? []) {
        if (e.start != null) {
          out.add(MapEntry(e.start!.toLocal(), e.title ?? '(no title)'));
        }
      }
    }
    out.sort((a, b) => a.key.compareTo(b.key));
    return out;
  }

  // ---- Reminders (local notifications) -------------------------------------
  static Future<DateTime> scheduleReminder(
      {required String text, required String whenISO}) async {
    await initNotifications();
    if (Platform.isAndroid) {
      await _notifications
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    }
    final when = DateTime.parse(whenISO);
    final scheduled = tz.TZDateTime.from(when, tz.local);
    await _notifications.zonedSchedule(
      when.millisecondsSinceEpoch ~/ 1000 % 100000,
      '⏰ Reminder',
      text,
      scheduled.isBefore(tz.TZDateTime.now(tz.local))
          ? tz.TZDateTime.now(tz.local).add(const Duration(seconds: 2))
          : scheduled,
      const NotificationDetails(
        android: AndroidNotificationDetails('reminders', 'Reminders',
            importance: Importance.max, priority: Priority.high),
        iOS: DarwinNotificationDetails(),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
    );
    return when;
  }

  // ---- Gmail OAuth (open server URL in browser) ----------------------------
  static Future<void> openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
    if (kDebugMode) print('open: $url');
  }
}
