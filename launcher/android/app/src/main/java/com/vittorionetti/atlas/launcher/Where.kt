package com.vittorionetti.atlas.launcher

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

/**
 * Where the phone is, for Sun mode (1.4.0): the home page works out the sky from the clock and this place.
 * Sunrise and sunset need only the town, so the launcher asks for approximate location (about 2 km), and the place
 * stays on the phone. It is kept, so the colors are right at once, and refreshed when it is a few hours old.
 */
class Where(private val ctx: Context, private val prefs: Prefs) {
    private val lm: LocationManager? = ctx.getSystemService(LocationManager::class.java)
    private val busy = AtomicBoolean(false)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var asking: CancellationSignal? = null                 // the request for a fresh place, while one is out

    fun allowed(): Boolean = ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun on(): Boolean = try { lm?.isLocationEnabled == true } catch (e: Exception) { false }

    /** For the page: whether location is allowed and on, and the last place (lat, lon, at) when there is one. */
    fun json(): JSONObject {
        val o = JSONObject().put("allowed", allowed()).put("on", on())
        prefs.place()?.let { p -> o.put("lat", p.optDouble("lat")).put("lon", p.optDouble("lon")).put("at", p.optLong("at")) }
        return o
    }

    /**
     * A newer place when the kept one is older than [maxAge] ms: first the last one Android already has (free, at
     * once), then, if that is old too, a fresh one from the fused or the network provider. [moved] runs on the main
     * thread when the place is the first one or moved by more than about a kilometer.
     */
    fun refresh(maxAge: Long, moved: () -> Unit) {
        val m = lm ?: return
        if (!allowed()) return
        lastKnown(m)?.let { keep(it, moved) }
        val kept = prefs.place()
        if (kept != null && System.currentTimeMillis() - kept.optLong("at") < maxAge) return
        val provider = provider(m) ?: return
        if (!busy.compareAndSet(false, true)) return
        val stop = CancellationSignal(); asking = stop
        val done = { if (asking === stop) { asking = null; busy.set(false) } }
        main.postDelayed({ if (asking === stop) stop.cancel(); done() }, 60_000L)          // no answer in a minute: next time
        try {
            m.getCurrentLocation(provider, stop, ctx.mainExecutor) { loc ->
                done()
                if (loc != null) keep(loc, moved)
            }
        } catch (e: Exception) { done() }
    }

    private fun lastKnown(m: LocationManager): Location? = try {
        m.getProviders(true).mapNotNull { p -> try { m.getLastKnownLocation(p) } catch (e: Exception) { null } }.maxByOrNull { it.time }
    } catch (e: Exception) { null }

    /** Fused (Android 12 on), else the network; GPS last, and only from Android 12, which gives approximate apps a coarse fix. */
    private fun provider(m: LocationManager): String? {
        val list = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31) list.add(LocationManager.FUSED_PROVIDER)
        list.add(LocationManager.NETWORK_PROVIDER)
        if (Build.VERSION.SDK_INT >= 31) list.add(LocationManager.GPS_PROVIDER)
        return list.firstOrNull { p -> try { m.isProviderEnabled(p) } catch (e: Exception) { false } }
    }

    /** Keeps a place newer than the kept one, to about 100 m; the page hears when it moved 0.01° (about a kilometer). */
    private fun keep(loc: Location, moved: () -> Unit) {
        val kept = prefs.place()
        if (kept != null && loc.time <= kept.optLong("at")) return
        val lat = Math.round(loc.latitude * 1000) / 1000.0
        val lon = Math.round(loc.longitude * 1000) / 1000.0
        prefs.setPlace(JSONObject().put("lat", lat).put("lon", lon).put("at", loc.time))
        if (kept == null || abs(kept.optDouble("lat") - lat) > .01 || abs(kept.optDouble("lon") - lon) > .01) main.post { moved() }
    }
}
