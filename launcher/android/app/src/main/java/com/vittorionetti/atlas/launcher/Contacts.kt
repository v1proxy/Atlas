package com.vittorionetti.atlas.launcher

import android.Manifest
import android.app.Activity
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
    private val pm = act.packageManager
    private val handlers = HashMap<String, String>()        // a contact row's type -> the app that opens it ("" for none)

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
        val byApp = LinkedHashMap<String, MutableList<Pair<Long, String>>>()   // app -> its rows (id, type)
        val cols = arrayOf(ContactsContract.Data._ID, ContactsContract.Data.MIMETYPE, ContactsContract.Data.DATA1,
            ContactsContract.Data.DATA2, ContactsContract.Data.DATA3, ContactsContract.Data.IS_SUPER_PRIMARY, ContactsContract.Data.IS_PRIMARY)
        act.contentResolver.query(ContactsContract.Data.CONTENT_URI, cols, "${ContactsContract.Data.CONTACT_ID}=?", arrayOf(id.toString()), null)?.use { c ->
            while (c.moveToNext()) {
                val mime = c.getString(1) ?: continue
                val data1 = c.getString(2)
                when {
                    mime == Phone.CONTENT_ITEM_TYPE -> { if (!data1.isNullOrBlank()) nums.add(Num(data1, c.getInt(3), c.getString(4), c.getInt(5) == 1 || c.getInt(6) == 1)) }
                    mime == Email.CONTENT_ITEM_TYPE -> { if (!data1.isNullOrBlank()) emails.add(data1) }
                    mime.startsWith("vnd.android.cursor.item/vnd.") -> {    // an app's own row: a chat or a call in WhatsApp, Signal, ...
                        val app = handler(mime, c.getLong(0))
                        if (app.isNotEmpty()) byApp.getOrPut(app) { ArrayList() } += c.getLong(0) to mime
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
                rows.firstOrNull { kind(it.second) == k }?.let { opt(title, k, row(it)) }
            }
            if (opts.isNotEmpty()) apps.put(reach(appName(app), *opts.toTypedArray()))
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

    private fun row(r: Pair<Long, String>) = JSONObject().put("kind", "data").put("id", r.first).put("mime", r.second)

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

    private fun handler(mime: String, rowId: Long): String = handlers.getOrPut(mime) {
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(ContentUris.withAppendedId(ContactsContract.Data.CONTENT_URI, rowId), mime)
        val app = pm.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        if (app == null || app == "android" || app == act.packageName) "" else app
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
        "sms" -> Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", a.getString("number"), null))
        "email" -> Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", a.getString("address"), null))
        "card" -> Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.getLookupUri(a.getLong("id"), a.getString("key")))
        else -> null
    }
}
