package com.vittorionetti.atlas.launcher

import android.webkit.CookieManager
import java.net.HttpURLConnection
import java.net.URL

/**
 * Atlas on your server, over Tailscale. Requests carry the same sign-in as the Files view (its cookie, kept by the
 * WebView), so the launcher never holds a password or a key of its own. Changes carry Atlas's X-Atlas header and no
 * Origin, as Atlas requires.
 */
class Server(private val base: () -> String) {
    val address: String get() = base()

    private fun cookie(): String? = address.takeIf { it.isNotEmpty() }?.let { CookieManager.getInstance().getCookie(it) }

    fun signedIn(): Boolean = cookie()?.split(';')?.any { it.trim().startsWith("atlas=") && it.trim().length > 6 } == true

    fun open(path: String, method: String = "GET", body: String? = null): HttpURLConnection {
        require(address.startsWith("https://")) { "no Atlas address set" }
        require(path.startsWith("/") && !path.startsWith("//")) { "bad path" }
        val c = URL(address + path).openConnection() as HttpURLConnection
        c.connectTimeout = 7000; c.readTimeout = 30000; c.instanceFollowRedirects = false
        c.requestMethod = method
        cookie()?.let { c.setRequestProperty("Cookie", it) }
        c.setRequestProperty("User-Agent", "AtlasLauncher/${BuildConfig.VERSION_NAME} (Android)")
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Atlas", "1")
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        return c
    }

    /** Status and text of a request; status 0 when Atlas can't be reached. */
    fun text(path: String, method: String = "GET", body: String? = null): Pair<Int, String> {
        val c = try { open(path, method, body) } catch (e: Exception) { return 0 to "" }
        return try {
            val code = c.responseCode
            val s = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            code to s
        } catch (e: Exception) { 0 to "" } finally { c.disconnect() }
    }
}
