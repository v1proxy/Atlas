package com.vittorionetti.atlas.launcher

import android.Manifest
import android.accounts.Account
import android.accounts.AccountManager
import android.app.Activity
import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.UserManager
import android.provider.CalendarContract
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import android.provider.CalendarContract.Reminders
import android.text.format.DateFormat
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.TimeZone

/**
 * The calendar on the right swipe (1.6.0): every calendar on the phone, personal and work, in one place, the way Outlook
 * shows all its accounts together. Android keeps the calendars of every account on the phone (Google, Outlook when it
 * syncs its calendars, Exchange, Samsung...) in one store, and the launcher reads them there: nothing is signed in twice
 * and nothing leaves the phone. A work profile's calendar comes too when the company lets personal apps see it
 * (Android's cross-profile calendar), with times, titles and places only. A new event or an answer to an invitation goes
 * into the same store, and each account's own app syncs it.
 */
class PhoneCalendar(private val act: Activity) {
    companion object {
        /** Links that join an online meeting, found in an event's place or notes; the first one wins. */
        private val JOIN = listOf(
            Regex("""https://teams\.microsoft\.com/l/meetup-join/[^\s"'<>]+""") to "Teams",
            Regex("""https://teams\.live\.com/meet/[^\s"'<>]+""") to "Teams",
            Regex("""https://[\w.-]*zoom\.us/(?:j|my|w|s)/[^\s"'<>]+""") to "Zoom",
            Regex("""https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s"'<>]*""") to "Meet",
            Regex("""https://[\w.-]*webex\.com/[^\s"'<>]+""") to "Webex",
            Regex("""https://(?:meet\.goto\.com|global\.gotomeeting\.com/join)/[^\s"'<>]+""") to "GoTo",
            Regex("""https://chime\.aws/\d+""") to "Chime",
            Regex("""https://meet\.jit\.si/[^\s"'<>]+""") to "Jitsi",
        )
        private const val MAX_EVENTS = 5000
    }
    private val cr: ContentResolver = act.contentResolver
    private val pm = act.packageManager
    private var observer: ContentObserver? = null

    fun allowed() = act.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
    fun canWrite() = act.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
    private fun hasWorkProfile() = try { act.getSystemService(UserManager::class.java).userProfiles.size > 1 } catch (e: Exception) { false }

    /** Each account's app by name ("Google", "Outlook", "Exchange"...), from the apps that add accounts to the phone. */
    private val apps: Map<String, String> by lazy {
        try {
            AccountManager.get(act).authenticatorTypes.associate { d ->
                d.type to (try { pm.getResourcesForApplication(d.packageName).getString(d.labelId) } catch (e: Exception) { "" })
            }
        } catch (e: Exception) { emptyMap() }
    }

    private fun appFor(type: String): String = when {
        type == CalendarContract.ACCOUNT_TYPE_LOCAL -> "This phone"
        type == "com.google" -> "Google"
        else -> apps[type]?.takeIf { it.isNotBlank() } ?: type.substringAfterLast('.').replaceFirstChar { it.uppercase() }
    }

    private fun hex(c: Int) = String.format("#%06x", c and 0xFFFFFF)

    /** Every calendar on the phone, shown or not, with its account and color; then the work profile's, if Android shares them. */
    fun list(): JSONObject {
        val out = JSONObject().put("allowed", allowed()).put("write", canWrite()).put("workProfile", hasWorkProfile())
            .put("h24", DateFormat.is24HourFormat(act))
        val cals = JSONArray()
        if (!allowed()) return out.put("calendars", cals)
        val cols = arrayOf(Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE, Calendars.OWNER_ACCOUNT,
            Calendars.CALENDAR_COLOR, Calendars.CALENDAR_ACCESS_LEVEL, Calendars.VISIBLE, Calendars.SYNC_EVENTS, Calendars.IS_PRIMARY)
        cr.query(Calendars.CONTENT_URI, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val type = c.getString(3) ?: ""
                cals.put(JSONObject().put("id", c.getLong(0)).put("work", false).put("name", c.getString(1) ?: "")
                    .put("account", c.getString(2) ?: "").put("type", type).put("app", appFor(type)).put("owner", c.getString(4) ?: "")
                    .put("color", hex(c.getInt(5))).put("access", c.getInt(6)).put("visible", c.getInt(7) == 1).put("sync", c.getInt(8) == 1)
                    .put("primary", !c.isNull(9) && c.getInt(9) == 1))
            }
        }
        // The work profile's calendars: Android shows a personal app only their color and whether they're shown.
        try {
            cr.query(Calendars.ENTERPRISE_CONTENT_URI, arrayOf(Calendars._ID, Calendars.CALENDAR_COLOR, Calendars.VISIBLE, Calendars.IS_PRIMARY), null, null, null)?.use { c ->
                while (c.moveToNext()) cals.put(JSONObject().put("id", c.getLong(0)).put("work", true).put("name", "").put("account", "")
                    .put("type", "work").put("app", "Work profile").put("owner", "").put("color", hex(c.getInt(1))).put("access", 0)
                    .put("visible", c.getInt(2) == 1).put("sync", true).put("primary", !c.isNull(3) && c.getInt(3) == 1))
            }
        } catch (e: Exception) { /* no work profile, or it keeps its calendar to itself */ }
        return out.put("calendars", cals)
    }

    /**
     * The occurrences of every shown event from Julian day [from] to [to] (Android's own day numbers, in the phone's time
     * zone; all-day events by their own dates). The notes stay here: only a link to join an online meeting goes out.
     */
    fun events(from: Int, to: Int): JSONObject {
        val out = JSONObject().put("allowed", allowed())
        val list = JSONArray()
        if (!allowed()) return out.put("events", list)
        val base = arrayOf(Instances._ID, Instances.EVENT_ID, Instances.BEGIN, Instances.END, Instances.START_DAY, Instances.END_DAY,
            Instances.START_MINUTE, Instances.END_MINUTE, Instances.ALL_DAY, Instances.TITLE, Instances.EVENT_LOCATION, Instances.CALENDAR_ID,
            Instances.DISPLAY_COLOR, Instances.SELF_ATTENDEE_STATUS, Instances.STATUS, Instances.AVAILABILITY, Instances.RRULE)
        val personal = base + arrayOf(Instances.DESCRIPTION, Instances.ORGANIZER, Instances.HAS_ATTENDEE_DATA)
        fun read(uri: Uri, cols: Array<String>, work: Boolean) {
            cr.query(uri.buildUpon().appendPath(from.toString()).appendPath(to.toString()).build(), cols, null, null, "${Instances.BEGIN} ASC")?.use { c ->
                while (c.moveToNext() && list.length() < MAX_EVENTS) {
                    val loc = c.getString(10) ?: ""
                    val o = JSONObject().put("iid", c.getLong(0)).put("id", c.getLong(1)).put("b", c.getLong(2)).put("e", c.getLong(3))
                        .put("sd", c.getInt(4)).put("ed", c.getInt(5)).put("sm", c.getInt(6)).put("em", c.getInt(7)).put("ad", c.getInt(8) == 1)
                        .put("t", c.getString(9) ?: "").put("loc", loc).put("cal", c.getLong(11)).put("col", hex(c.getInt(12)))
                        .put("me", c.getInt(13)).put("st", if (c.isNull(14)) Events.STATUS_CONFIRMED else c.getInt(14)).put("av", c.getInt(15))
                        .put("rr", !c.getString(16).isNullOrEmpty())
                    var link = joinLink(loc)
                    if (work) o.put("w", true)
                    else {
                        o.put("org", c.getString(18) ?: "").put("att", c.getInt(19) == 1)
                        if (link == null) link = joinLink(c.getString(17) ?: "")
                    }
                    if (link != null) o.put("join", link.first).put("jl", link.second)
                    list.put(o)
                }
            }
        }
        read(Instances.CONTENT_BY_DAY_URI, personal, false)
        try { read(Instances.ENTERPRISE_CONTENT_BY_DAY_URI, base, true) } catch (e: Exception) { /* not shared, or no work profile */ }
        return out.put("events", list)
    }

    private fun joinLink(text: String): Pair<String, String>? {
        if (text.isEmpty()) return null
        for ((re, app) in JOIN) re.find(text)?.let { return it.value.trimEnd('.', ',', ')', ';', '>') to app }
        return null
    }

    /** One event in full, for its details: notes, organizer, repeat rule, time zone and the people invited. */
    fun event(id: Long): JSONObject {
        val o = JSONObject().put("id", id)
        if (!allowed()) return o
        cr.query(ContentUris.withAppendedId(Events.CONTENT_URI, id), arrayOf(Events.DESCRIPTION, Events.ORGANIZER, Events.RRULE,
            Events.EVENT_TIMEZONE, Events.CALENDAR_ID, Events.GUESTS_CAN_SEE_GUESTS), null, null, null)?.use { c ->
            if (c.moveToFirst()) o.put("desc", (c.getString(0) ?: "").take(20000)).put("org", c.getString(1) ?: "")
                .put("rrule", c.getString(2) ?: "").put("tz", c.getString(3) ?: "").put("cal", c.getLong(4))
        }
        val att = JSONArray()
        cr.query(Attendees.CONTENT_URI, arrayOf(Attendees.ATTENDEE_NAME, Attendees.ATTENDEE_EMAIL, Attendees.ATTENDEE_STATUS,
            Attendees.ATTENDEE_RELATIONSHIP, Attendees.ATTENDEE_TYPE), "${Attendees.EVENT_ID}=?", arrayOf(id.toString()), null)?.use { c ->
            while (c.moveToNext() && att.length() < 300) att.put(JSONObject().put("n", c.getString(0) ?: "").put("e", c.getString(1) ?: "")
                .put("s", c.getInt(2)).put("r", c.getInt(3)).put("ty", c.getInt(4)))
        }
        return o.put("att", att)
    }

    /**
     * Accept, Tentative or Decline ([status]: 1, 4 or 2). For one occurrence of a repeating event Android keeps an
     * exception with the answer; otherwise the invitation's row for the calendar's owner takes it. Either way the
     * account's app sends the answer to the organizer when it syncs.
     */
    fun respond(id: Long, begin: Long, status: Int, one: Boolean): Boolean {
        check(canWrite()) { "allow the calendar first" }
        require(status == Attendees.ATTENDEE_STATUS_ACCEPTED || status == Attendees.ATTENDEE_STATUS_TENTATIVE || status == Attendees.ATTENDEE_STATUS_DECLINED) { "not an answer" }
        if (one) {
            val v = ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, begin); put(Events.SELF_ATTENDEE_STATUS, status); put(Events.STATUS, Events.STATUS_CONFIRMED)
            }
            return cr.insert(Uri.withAppendedPath(Events.CONTENT_EXCEPTION_URI, id.toString()), v) != null
        }
        var cal = -1L
        cr.query(ContentUris.withAppendedId(Events.CONTENT_URI, id), arrayOf(Events.CALENDAR_ID), null, null, null)?.use { c -> if (c.moveToFirst()) cal = c.getLong(0) }
        var owner = ""
        cr.query(ContentUris.withAppendedId(Calendars.CONTENT_URI, cal), arrayOf(Calendars.OWNER_ACCOUNT), null, null, null)?.use { c -> if (c.moveToFirst()) owner = c.getString(0) ?: "" }
        var me = -1L
        cr.query(Attendees.CONTENT_URI, arrayOf(Attendees._ID, Attendees.ATTENDEE_EMAIL), "${Attendees.EVENT_ID}=?", arrayOf(id.toString()), null)?.use { c ->
            while (c.moveToNext()) if (owner.isNotEmpty() && (c.getString(1) ?: "").equals(owner, ignoreCase = true)) { me = c.getLong(0); break }
        }
        if (me < 0) return false
        val v = ContentValues().apply { put(Attendees.ATTENDEE_STATUS, status); put(Attendees.EVENT_ID, id) }
        return cr.update(ContentUris.withAppendedId(Attendees.CONTENT_URI, me), v, null, null) > 0
    }

    /** A new event in calendar [a].cal: timed (begin and end in ms) or all day (startDate to endDate, both included). */
    fun create(a: JSONObject): Long {
        check(canWrite()) { "allow the calendar first" }
        val allDay = a.optBoolean("allDay")
        val remind = a.optInt("remind", -1)
        val v = ContentValues().apply {
            put(Events.CALENDAR_ID, a.getLong("cal"))
            put(Events.TITLE, a.optString("title").trim().ifEmpty { "New event" })
            a.optString("loc").trim().takeIf { it.isNotEmpty() }?.let { put(Events.EVENT_LOCATION, it) }
            a.optString("notes").trim().takeIf { it.isNotEmpty() }?.let { put(Events.DESCRIPTION, it) }
            if (allDay) {
                val s = LocalDate.parse(a.getString("startDate")); val e = LocalDate.parse(a.getString("endDate"))
                put(Events.ALL_DAY, 1); put(Events.EVENT_TIMEZONE, "UTC")
                put(Events.DTSTART, s.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
                put(Events.DTEND, (if (e.isBefore(s)) s else e).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            } else {
                val b = a.getLong("begin")
                put(Events.DTSTART, b); put(Events.DTEND, maxOf(a.getLong("end"), b + 60_000)); put(Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
            }
            if (remind >= 0) put(Events.HAS_ALARM, 1)
        }
        val uri = cr.insert(Events.CONTENT_URI, v) ?: throw IllegalStateException("the calendar didn't take it")
        val id = ContentUris.parseId(uri)
        if (remind >= 0) try {
            cr.insert(Reminders.CONTENT_URI, ContentValues().apply { put(Reminders.EVENT_ID, id); put(Reminders.MINUTES, remind); put(Reminders.METHOD, Reminders.METHOD_ALERT) })
        } catch (e: Exception) { /* the event stands without its reminder */ }
        return id
    }

    /** Shows a calendar the phone keeps hidden or unsynced (in Calendars, Turn on): Android then syncs its events. */
    fun show(id: Long): Boolean {
        check(canWrite()) { "allow the calendar first" }
        val ok = cr.update(ContentUris.withAppendedId(Calendars.CONTENT_URI, id), ContentValues().apply { put(Calendars.VISIBLE, 1); put(Calendars.SYNC_EVENTS, 1) }, null, null) > 0
        if (ok) sync()
        return ok
    }

    /** Asks every account on the phone to sync its calendars now (Calendars, Sync now). */
    fun sync(): Int {
        if (!allowed()) return 0
        val seen = HashSet<Account>()
        cr.query(Calendars.CONTENT_URI, arrayOf(Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val n = c.getString(0); val t = c.getString(1)
                if (!n.isNullOrEmpty() && !t.isNullOrEmpty() && t != CalendarContract.ACCOUNT_TYPE_LOCAL) seen += Account(n, t)
            }
        }
        val extras = Bundle().apply { putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true); putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true) }
        for (acc in seen) try { ContentResolver.requestSync(acc, CalendarContract.AUTHORITY, extras) } catch (e: Exception) { }
        return seen.size
    }

    // ---- the phone's calendar apps ------------------------------------------------------------------------------------
    fun viewIntent(id: Long, begin: Long, end: Long, edit: Boolean): Intent =
        Intent(if (edit) Intent.ACTION_EDIT else Intent.ACTION_VIEW, ContentUris.withAppendedId(Events.CONTENT_URI, id))
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin).putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)

    fun insertIntent(a: JSONObject): Intent = Intent(Intent.ACTION_INSERT, Events.CONTENT_URI).apply {
        if (a.has("begin")) putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, a.getLong("begin"))
        if (a.has("end")) putExtra(CalendarContract.EXTRA_EVENT_END_TIME, a.getLong("end"))
        putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, a.optBoolean("allDay"))
        a.optString("title").takeIf { it.isNotBlank() }?.let { putExtra(Events.TITLE, it) }
        a.optString("loc").takeIf { it.isNotBlank() }?.let { putExtra(Events.EVENT_LOCATION, it) }
        a.optString("notes").takeIf { it.isNotBlank() }?.let { putExtra(Events.DESCRIPTION, it) }
    }

    /** The phone's calendar app, at [at] (ms). */
    fun dayIntent(at: Long): Intent = Intent(Intent.ACTION_VIEW, CalendarContract.CONTENT_URI.buildUpon().appendPath("time").appendPath(at.toString()).build())

    /** A work event in the work profile's calendar app, when it has one that opens events from here. */
    fun openWork(id: Long, begin: Long, end: Long, allDay: Boolean): Boolean =
        try { CalendarContract.startViewCalendarEventInManagedProfile(act, id, begin, end, allDay, Intent.FLAG_ACTIVITY_NEW_TASK) } catch (e: Exception) { false }

    /** Tells the page when any calendar changes (a sync, an edit in another app), at most every 1.5 s. */
    fun listen(changed: () -> Unit) {
        if (observer != null || !allowed()) return
        val h = Handler(Looper.getMainLooper())
        val o = object : ContentObserver(h) {
            private var pending = false
            override fun onChange(selfChange: Boolean) {
                if (pending) return
                pending = true
                h.postDelayed({ pending = false; changed() }, 1500)
            }
        }
        try { cr.registerContentObserver(CalendarContract.CONTENT_URI, true, o); observer = o } catch (e: Exception) { return }
        try { cr.registerContentObserver(Events.ENTERPRISE_CONTENT_URI, true, o) } catch (e: Exception) { }
    }
}
