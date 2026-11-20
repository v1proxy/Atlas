package com.vittorionetti.atlas.launcher

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Phone
import org.json.JSONArray
import org.json.JSONObject
import java.text.Collator

/**
 * Contacts in the home screen's search (1.3.0): the people whose names match what is typed, each with the apps that
 * can reach them. Phone and Messages use the contact's main number and Email its first address. WhatsApp, Signal,
 * Telegram and the like add their own rows to a contact (one row for the chat, one for each kind of call), and a row
 * opens in its app the way the Contacts app opens it. Everything stays on the phone.
 */
class Contacts(private val act: Activity) {
    companion object {
        /** Each app's own link to a chat by phone number, for someone the app knows but whose rows no app here opens. */
        private val LINKS = linkedMapOf<String, (String) -> String>(
            "com.whatsapp" to { n -> "https://wa.me/" + n.filter { it.isDigit() } },
            "org.thoughtcrime.securesms" to { n -> "https://signal.me/#p/+" + n.filter { it.isDigit() } },
            "org.telegram.messenger" to { n -> "tg://resolve?phone=" + n.filter { it.isDigit() } },
        )
    }
    private val pm = act.packageManager
    private val handlers = HashMap<String, ComponentName?>()   // a contact row's type (and account) -> the screen that opens it

    fun allowed() = act.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    /** Up to [max] contacts whose names match [q], starred ones first, then by name. */
    fun search(q: String, max: Int = 5): JSONArray {
        val out = JSONArray()
        if (q.isBlank() || !allowed()) return out
        val found = ArrayList<Triple<Long, String, String>>()          // id, lookup key, name
        val starred = HashSet<Long>()
        val uri = Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(q.trim()))
        val cols = arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.LOOKUP_KEY,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY, ContactsContract.Contacts.STARRED)
        act.contentResolver.query(uri, cols, null, null, null)?.use { c ->
            while (c.moveToNext() && found.size < 60) {
                val name = c.getString(2)?.takeIf { it.isNotBlank() } ?: continue
                found += Triple(c.getLong(0), c.getString(1) ?: "", name)
                if (c.getInt(3) == 1) starred += c.getLong(0)
            }
        }
        val col = Collator.getInstance()
        found.sortWith(compareBy<Triple<Long, String, String>> { it.first !in starred }.thenComparator { a, b -> col.compare(a.third, b.third) })
        for ((id, key, name) in found.take(max)) out.put(contact(id, key, name))
        return out
    }

    private fun contact(id: Long, key: String, name: String): JSONObject {
        class Num(val number: String, val type: Int, val label: String?, val main: Boolean)
        val nums = ArrayList<Num>(); val emails = ArrayList<String>()
        val accounts = HashMap<Long, String>()                  // each of the contact's raw contacts -> its account ("com.whatsapp", ...)
        act.contentResolver.query(ContactsContract.RawContacts.CONTENT_URI, arrayOf(ContactsContract.RawContacts._ID, ContactsContract.RawContacts.ACCOUNT_TYPE),
            "${ContactsContract.RawContacts.CONTACT_ID}=?", arrayOf(id.toString()), null)?.use { c ->
            while (c.moveToNext()) accounts[c.getLong(0)] = c.getString(1) ?: ""
        }
        val byApp = LinkedHashMap<String, MutableList<Row>>()   // app -> its rows
        val cols = arrayOf(ContactsContract.Data._ID, ContactsContract.Data.MIMETYPE, ContactsContract.Data.DATA1, ContactsContract.Data.DATA2,
            ContactsContract.Data.DATA3, ContactsContract.Data.IS_SUPER_PRIMARY, ContactsContract.Data.IS_PRIMARY, ContactsContract.Data.RAW_CONTACT_ID)
        act.contentResolver.query(ContactsContract.Data.CONTENT_URI, cols, "${ContactsContract.Data.CONTACT_ID}=?", arrayOf(id.toString()), null)?.use { c ->
            while (c.moveToNext()) {
                val mime = c.getString(1) ?: continue
                val data1 = c.getString(2)
                when {
                    mime == Phone.CONTENT_ITEM_TYPE -> { if (!data1.isNullOrBlank()) nums.add(Num(data1, c.getInt(3), c.getString(4), c.getInt(5) == 1 || c.getInt(6) == 1)) }
                    mime == Email.CONTENT_ITEM_TYPE -> { if (!data1.isNullOrBlank()) emails.add(data1) }
                    mime.startsWith("vnd.android.cursor.item/vnd.") -> {    // an app's own row: a chat or a call in WhatsApp, Signal, ...
                        val cn = handler(mime, c.getLong(0), accounts[c.getLong(7)])
                        if (cn != null) byApp.getOrPut(cn.packageName) { ArrayList() } += Row(c.getLong(0), mime, cn)
                    }
                }
            }
        }
        val main = nums.firstOrNull { it.main } ?: nums.firstOrNull { it.type == Phone.TYPE_MOBILE } ?: nums.firstOrNull()
        val apps = JSONArray()
        if (main != null) {
            apps.put(reach(label(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", main.number, null)), "Phone"),
                opt("Call", "voice", JSONObject().put("kind", "call").put("number", main.number))))
            apps.put(reach(label(Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", main.number, null)), "Messages"),
                opt("Message", "chat", JSONObject().put("kind", "sms").put("number", main.number))))
        }
        for ((app, rows) in byApp) {                                  // its chat, then its calls: Message, Call, Video call
            val opts = listOf("chat" to "Message", "voice" to "Call", "video" to "Video call").mapNotNull { (k, title) ->
                rows.firstOrNull { kind(it.mime) == k }?.let { opt(title, k, row(it)) }
            }
            if (opts.isNotEmpty()) apps.put(reach(appName(app), *opts.toTypedArray()))
        }
        // On WhatsApp, Signal or Telegram (the app keeps the contact in its own account) but with no row an app here opens:
        // the app's own link by number opens the chat.
        if (main != null) for ((app, link) in LINKS) {
            if (app in byApp || app !in accounts.values) continue
            val i = Intent(Intent.ACTION_VIEW, Uri.parse(link(main.number))).setPackage(app)
            if (pm.resolveActivity(i, 0) != null)
                apps.put(reach(appName(app), opt("Message", "chat", JSONObject().put("kind", "link").put("url", i.dataString).put("pkg", app))))
        }
        emails.firstOrNull()?.let {
            apps.put(reach(label(Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", it, null)), "Email"),
                opt("Email", "mail", JSONObject().put("kind", "email").put("address", it))))
        }
        val sub = when {
            main != null -> main.number + " · " + Phone.getTypeLabel(act.resources, main.type, main.label).toString().lowercase()
            emails.isNotEmpty() -> emails[0]
            else -> ""
        }
        return JSONObject().put("id", id).put("key", key).put("name", name).put("sub", sub).put("apps", apps)
    }

    /** An app under a contact, with what it can do there: one thing opens at a tap, two or more are listed under it. */
    private fun reach(name: String, vararg opts: JSONObject) = JSONObject().put("name", name).put("opts", JSONArray(opts.toList()))

    private fun opt(label: String, kind: String, act: JSONObject) = JSONObject().put("label", label).put("k", kind).put("act", act)

    private class Row(val id: Long, val mime: String, val opens: ComponentName)

    private fun row(r: Row) = JSONObject().put("kind", "data").put("id", r.id).put("mime", r.mime)
        .put("pkg", r.opens.packageName).put("cls", r.opens.className)

    /** A row's type says what it does: "...whatsapp.profile" chats, "...whatsapp.voip.call" calls, "...video.call" calls with video. */
    private fun kind(mime: String): String {
        val m = mime.lowercase()
        return when {
            "video" in m -> "video"
            listOf("message", "chat", "profile", "contact", "conversation").any { it in m } -> "chat"
            "call" in m || "voip" in m -> "voice"
            else -> "chat"
        }
    }

    /**
     * The screen that opens a row, named outright so that Android never asks "open with?" (it would when the phone's
     * contacts app also takes such rows, or with a second copy of WhatsApp): the app that keeps the row in its own
     * account first, then the app named in the row's type, then any app but a contacts app.
     */
    private fun handler(mime: String, rowId: Long, account: String?): ComponentName? {
        val key = "$mime|$account"
        if (handlers.containsKey(key)) return handlers[key]
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(ContentUris.withAppendedId(ContactsContract.Data.CONTENT_URI, rowId), mime)
        val found = pm.queryIntentActivities(i, 0).map { it.activityInfo }.filter { it.exported && it.packageName != "android" && it.packageName != act.packageName }
        val pick = found.firstOrNull { it.packageName == account } ?: found.firstOrNull { mime.contains(it.packageName) }
            ?: found.firstOrNull { !it.packageName.contains("contacts") }
        return pick?.let { ComponentName(it.packageName, it.name) }.also { handlers[key] = it }
    }

    /** The name of the app that would open [i], or [fallback] when there is none or Android would ask which one. */
    private fun label(i: Intent, fallback: String): String {
        val app = pm.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        return if (app == null || app == "android") fallback else appName(app, fallback)
    }

    private fun appName(app: String, fallback: String = app): String =
        try { pm.getApplicationLabel(pm.getApplicationInfo(app, 0)).toString() } catch (e: Exception) { fallback }

    /** What a tap or a hold on an app under a contact opens; calls are placed by the activity (they need a permission). */
    fun intent(a: JSONObject): Intent? = when (a.optString("kind")) {
        "data" -> Intent(Intent.ACTION_VIEW).setDataAndType(ContentUris.withAppendedId(ContactsContract.Data.CONTENT_URI, a.getLong("id")), a.getString("mime"))
            .apply { if (a.has("cls")) setClassName(a.getString("pkg"), a.getString("cls")) }
        "link" -> Intent(Intent.ACTION_VIEW, Uri.parse(a.getString("url"))).setPackage(a.getString("pkg"))
        "sms" -> Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", a.getString("number"), null))
        "email" -> Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", a.getString("address"), null))
        "card" -> Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.getLookupUri(a.getLong("id"), a.getString("key")))
        else -> null
    }
}
