package com.vittorionetti.atlas.launcher

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the launcher keeps on the phone: the dial, your moves on the Apps map, the layout and color,
 * and when you opened each app from Atlas (for sizing apps when Android's usage data is off).
 * Each value is stored as JSON inside a one-element array, so strings, numbers and objects all round-trip.
 */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("atlas", Context.MODE_PRIVATE)
    private val lock = Any()

    companion object {
        val PAGE_KEYS = setOf("pins", "over", "order", "tone", "theme", "view", "metric", "cats", "catEdits", "use", "cal")
        const val MAX_PINS = 10
        private const val DAY = 86_400_000L
    }

    private fun read(key: String): Any? = sp.getString(key, null)?.let {
        try { JSONArray(it).opt(0) } catch (e: Exception) { null }
    }

    private fun write(key: String, value: Any?) {
        sp.edit().putString(key, JSONArray().put(value ?: JSONObject.NULL).toString()).apply()
    }

    /** Everything the page may read. */
    fun page(): JSONObject = synchronized(lock) {
        val o = JSONObject()
        for (k in PAGE_KEYS) read(k)?.let { if (it != JSONObject.NULL) o.put(k, it) }
        o
    }

    /** The page may only change its own keys. */
    fun setFromPage(key: String, value: Any?) {
        if (key !in PAGE_KEYS) throw IllegalArgumentException("unknown setting")
        synchronized(lock) { write(key, value) }
    }

    /** The launcher's color (Settings, Appearance) as JSON, for Atlas in the Files view; empty when never set. */
    fun themeJson(): String = synchronized(lock) { (read("theme") as? JSONObject)?.toString() ?: "" }

    /** Where the phone was last, for Sun mode: {lat, lon, at}, approximate, kept on the phone only (Where.kt). */
    fun place(): JSONObject? = synchronized(lock) { read("place") as? JSONObject }
    fun setPlace(p: JSONObject) = synchronized(lock) { write("place", p) }

    fun string(key: String, def: String = ""): String = synchronized(lock) { (read(key) as? String) ?: def }
    fun setString(key: String, value: String) = synchronized(lock) { write(key, value) }
    fun flag(key: String): Boolean = synchronized(lock) { read(key) == true }
    fun setFlag(key: String, on: Boolean) = synchronized(lock) { write(key, on) }

    // ---- the dial's files, changed from Atlas's own page (Files) ----------------------------------
    private fun pins(): JSONObject {
        val p = read("pins") as? JSONObject ?: JSONObject()
        if (p.optJSONArray("apps") == null) p.put("apps", JSONArray())
        if (p.optJSONArray("files") == null) p.put("files", JSONArray())
        return p
    }

    fun isPinnedFile(path: String): Boolean = synchronized(lock) {
        val files = pins().getJSONArray("files")
        (0 until files.length()).any { files.optJSONObject(it)?.optString("path") == path }
    }

    /** Adds the file or folder, or takes it off when it is already there. Answers added, removed or full. */
    fun togglePinFile(item: JSONObject): String = synchronized(lock) {
        val p = pins(); val files = p.getJSONArray("files"); val path = item.optString("path")
        if (path.isEmpty()) return "removed"
        for (i in 0 until files.length()) {
            if (files.optJSONObject(i)?.optString("path") == path) { files.remove(i); write("pins", p); return "removed" }
        }
        if (files.length() >= MAX_PINS) return "full"
        files.put(JSONObject().put("path", path).put("name", item.optString("name", path.substringAfterLast('\\')))
            .put("dir", item.optBoolean("dir")).put("kind", item.optString("kind")))
        write("pins", p)
        "added"
    }

    // ---- apps opened from Atlas ------------------------------------------------------------------------
    fun recordLaunch(key: String) = synchronized(lock) {
        val all = read("launches") as? JSONObject ?: JSONObject()
        val now = System.currentTimeMillis(); val cut = now - 60 * DAY
        val old = all.optJSONArray(key) ?: JSONArray()
        val keep = JSONArray()
        for (i in 0 until old.length()) { val t = old.optLong(i); if (t >= cut) keep.put(t) }
        keep.put(now)
        while (keep.length() > 300) keep.remove(0)
        all.put(key, keep)
        write("launches", all)
    }

    fun launches(): JSONObject = synchronized(lock) { (read("launches") as? JSONObject) ?: JSONObject() }
}
