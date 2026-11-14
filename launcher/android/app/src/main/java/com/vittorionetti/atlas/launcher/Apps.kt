package com.vittorionetti.atlas.launcher

import android.Manifest
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.LauncherActivityInfo
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.UserHandle
import android.os.UserManager
import android.util.LruCache
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Every app on the phone that has an icon, in every profile (personal and work), with what the Apps map needs:
 * name, Android's own category for it, install and update dates, and how much it is used.
 * Use comes from Android's usage data when you allow it; otherwise from the apps you open from Atlas.
 * Nothing here leaves the phone.
 */
class Apps(private val ctx: Context, private val prefs: Prefs) {
    private val la = ctx.getSystemService(LauncherApps::class.java)
    private val um = ctx.getSystemService(UserManager::class.java)
    private val pm = ctx.packageManager
    private val icons = object : LruCache<String, ByteArray>(16 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }
    @Volatile private var usageCache: Pair<Long, Map<String, Usage>>? = null

    private data class Usage(val last: Long, val fg30: Long, val opens30: Int)

    companion object { private const val DAY = 86_400_000L }

    fun hasUsageAccess(): Boolean {
        val ops = ctx.getSystemService(AppOpsManager::class.java)
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        return if (mode == AppOpsManager.MODE_DEFAULT)
            ctx.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
        else mode == AppOpsManager.MODE_ALLOWED
    }

    fun forgetUsage() { usageCache = null }

    private fun usage(): Map<String, Usage> {
        usageCache?.let { if (System.currentTimeMillis() - it.first < 60_000) return it.second }
        val usm = ctx.getSystemService(UsageStatsManager::class.java)
        val now = System.currentTimeMillis(); val from30 = now - 30 * DAY
        val last = HashMap<String, Long>(); val fg = HashMap<String, Long>(); val opens = HashMap<String, Int>()
        for ((pkg, s) in usm.queryAndAggregateUsageStats(now - 730 * DAY, now)) last[pkg] = s.lastTimeUsed
        for ((pkg, s) in usm.queryAndAggregateUsageStats(from30, now)) fg[pkg] = s.totalTimeInForeground
        // An open is an app coming to the front after another one.
        val events = usm.queryEvents(from30, now); val e = UsageEvents.Event(); var prev: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.eventType != UsageEvents.Event.ACTIVITY_RESUMED) continue
            val p = e.packageName ?: continue
            if (p != prev) { opens[p] = (opens[p] ?: 0) + 1; prev = p }
            if (e.timeStamp > (last[p] ?: 0L)) last[p] = e.timeStamp
        }
        val out = HashMap<String, Usage>()
        for (p in last.keys + fg.keys + opens.keys) out[p] = Usage(last[p] ?: 0L, fg[p] ?: 0L, opens[p] ?: 0)
        usageCache = now to out
        return out
    }

    /** The list the page asks for: {apps: [...], usage: true when Android's usage data is on}. */
    fun list(): JSONObject {
        val usageOn = hasUsageAccess()
        val use = if (usageOn) try { usage() } catch (e: Exception) { emptyMap() } else emptyMap()
        val launches = prefs.launches()
        val now = System.currentTimeMillis(); val me = Process.myUserHandle()
        val arr = JSONArray()
        for (user in la.profiles) {
            val serial = um.getSerialNumberForUser(user)
            val list = try { la.getActivityList(null, user) } catch (e: Exception) { emptyList<LauncherActivityInfo>() }
            for (info in list) {
                val cn = info.componentName; val pkg = cn.packageName
                if (pkg == ctx.packageName) continue
                val key = cn.flattenToShortString() + "|" + serial
                val ai = info.applicationInfo
                val updated = if (user == me) try { pm.getPackageInfo(pkg, 0).lastUpdateTime } catch (e: Exception) { 0L } else 0L
                var n30 = 0; var lastLaunch = 0L
                launches.optJSONArray(key)?.let { l ->
                    for (i in 0 until l.length()) { val t = l.optLong(i); if (t > now - 30 * DAY) n30++; if (t > lastLaunch) lastLaunch = t }
                }
                val u = if (user == me) use[pkg] else null
                arr.put(JSONObject()
                    .put("key", key).put("label", info.label?.toString() ?: pkg).put("pkg", pkg).put("cls", cn.className)
                    .put("cat", ai.category).put("system", (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0).put("work", user != me)
                    .put("installed", info.firstInstallTime).put("updated", updated)
                    .put("lastUsed", u?.last ?: 0L).put("fg30", u?.fg30 ?: 0L).put("opens30", u?.opens30 ?: 0)
                    .put("launches30", n30).put("lastLaunch", lastLaunch))
            }
        }
        return JSONObject().put("apps", arr).put("usage", usageOn)
    }

    private fun parse(key: String): Pair<ComponentName, UserHandle>? {
        val comp = key.substringBefore('|'); val serial = key.substringAfter('|', "0").toLongOrNull() ?: 0L
        val cn = ComponentName.unflattenFromString(comp) ?: return null
        val user = um.getUserForSerialNumber(serial) ?: return null
        return cn to user
    }

    fun find(key: String): LauncherActivityInfo? {
        val (cn, user) = parse(key) ?: return null
        return try { la.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(cn), user) }
        catch (e: Exception) { null }
    }

    /** The app's icon as Android draws it (work apps carry the work badge), as a PNG. */
    fun iconPng(key: String, px: Int): ByteArray? {
        icons.get(key)?.let { return it }
        val info = find(key) ?: return null
        val d = info.getBadgedIcon(ctx.resources.displayMetrics.densityDpi)
        val bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, px, px); d.draw(Canvas(bmp))
        val out = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.PNG, 100, out); bmp.recycle()
        return out.toByteArray().also { icons.put(key, it) }
    }

    fun launch(key: String, bounds: Rect?, opts: Bundle?) {
        val (cn, user) = parse(key) ?: throw IllegalStateException("that app is not on this phone any more")
        la.startMainActivity(cn, user, bounds, opts)
        prefs.recordLaunch(key)
    }

    fun details(key: String) {
        val (cn, user) = parse(key) ?: return
        la.startAppDetailsActivity(cn, user, null, null)
    }

    fun isWork(key: String): Boolean = parse(key)?.second?.let { it != Process.myUserHandle() } ?: false

    /** Tells the page when apps are installed, removed or updated. */
    fun listen(onChange: () -> Unit) {
        la.registerCallback(object : LauncherApps.Callback() {
            override fun onPackageRemoved(packageName: String?, user: UserHandle?) { icons.evictAll(); onChange() }
            override fun onPackageAdded(packageName: String?, user: UserHandle?) { onChange() }
            override fun onPackageChanged(packageName: String?, user: UserHandle?) { icons.evictAll(); onChange() }
            override fun onPackagesAvailable(packageNames: Array<out String>?, user: UserHandle?, replacing: Boolean) { onChange() }
            override fun onPackagesUnavailable(packageNames: Array<out String>?, user: UserHandle?, replacing: Boolean) { onChange() }
        }, Handler(Looper.getMainLooper()))
    }
}
