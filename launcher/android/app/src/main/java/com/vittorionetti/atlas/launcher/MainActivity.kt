package com.vittorionetti.atlas.launcher

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityOptions
import android.app.DownloadManager
import android.app.PendingIntent
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * The Atlas launcher: Android's Home screen.
 *
 * Two WebViews share the screen, one shown at a time:
 *  - home:  the launcher's own page (frame, Apps and Files boxes, the dial, the Apps map), served from inside
 *           the app at https://appassets.androidplatform.net. It never touches the network: apps come from Android and
 *           Atlas data comes through [Server], both via the "Launcher" bridge.
 *  - files: Atlas itself, from your Atlas server over Tailscale, signed in as this launcher. Atlas sees the
 *           "AtlasLauncher" bridge and switches to launcher mode (a Home button, one tap opens, a long press adds to
 *           the dial).
 */
class MainActivity : Activity() {
    lateinit var prefs: Prefs
    lateinit var apps: Apps
    lateinit var server: Server
    private lateinit var root: FrameLayout
    private lateinit var home: WebView
    private lateinit var files: WebView
    private val pool = Executors.newFixedThreadPool(4)
    private var showingFiles = false
    private var filesReady = false
    private var pendingFilesJs: String? = null
    private var pairing = false
    private var usageWas = false
    private var latest: JSONObject? = null
    private var cfgServer = ""
    private var cfgPair = ""
    private val iconPx get() = (48 * resources.displayMetrics.density).roundToInt().coerceIn(96, 192)

    companion object {
        const val ASSETS = "appassets.androidplatform.net"
        private val IVORY = Color.rgb(0xF2, 0xEB, 0xD8)             // the page's ivory (launcher.css)
        private const val REQ_HOME = 41
    }

    // ---- start ---------------------------------------------------------------------------------------------
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        prefs = Prefs(this)
        apps = Apps(this, prefs)
        try {
            val j = JSONObject(assets.open("launcher.json").bufferedReader().use { it.readText() })
            cfgServer = j.optString("server").trimEnd('/'); cfgPair = j.optString("pair")
        } catch (e: Exception) { /* a build without settings: the address can be set from Options */ }
        server = Server { prefs.string("server", cfgServer).trimEnd('/').takeIf { it.startsWith("https://") } ?: "" }

        // Black (or ivory) edge to edge; the system bars sit over it and the content is padded clear of them and of the keyboard.
        window.setDecorFitsSystemWindows(false)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = insets.getInsets(WindowInsets.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsets.CONSUMED
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        files = webView(); home = webView()
        root.addView(files, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(home, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        files.visibility = View.GONE
        setContentView(root)
        applyScheme()

        home.addJavascriptInterface(HomeBridge(), "Launcher")
        home.webViewClient = HomeClient()
        home.loadUrl("https://$ASSETS/index.html")

        files.settings.userAgentString = files.settings.userAgentString + " AtlasLauncher/" + BuildConfig.VERSION_NAME
        files.addJavascriptInterface(FilesBridge(), "AtlasLauncher")
        files.webViewClient = FilesClient()
        files.setDownloadListener { url, ua, disposition, mime, _ -> download(url, ua, disposition, mime) }
        loadFiles()

        usageWas = apps.hasUsageAccess()
        apps.listen { event("apps") }

        // Opened from the apps after Quit: be the Home screen again (Android asks once the page is ready).
        if (packageManager.getComponentEnabledSetting(homeAlias) == PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
            packageManager.setComponentEnabledSetting(homeAlias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
            prefs.setFlag("askedHome", false)
        }
    }

    private val homeAlias get() = ComponentName(this, "$packageName.Home")

    /** Black or ivory (hold the Settings circle): the window behind the pages and the bars' icons follow the page. */
    private fun applyScheme() = runOnUiThread {
        val ivory = try { JSONObject(prefs.themeJson().ifEmpty { "{}" }).optBoolean("ivory") } catch (e: Exception) { false }
        val bg = if (ivory) IVORY else Color.BLACK
        root.setBackgroundColor(bg); home.setBackgroundColor(bg); files.setBackgroundColor(bg)
        val dark = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(if (ivory) dark else 0, dark)    // dark icons on ivory, light on black
    }

    /** Settings, Quit: Atlas stops being a Home screen and the phone's own launcher takes over. */
    private fun quit() = runOnUiThread {
        packageManager.setComponentEnabledSetting(homeAlias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        try { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
        finishAndRemoveTask()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun webView() = WebView(this).apply {
        setBackgroundColor(Color.BLACK)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.textZoom = 100
        settings.mediaPlaybackRequiresUserGesture = true
        webChromeClient = WebChromeClient()                 // Atlas's confirm and prompt dialogs (Delete, New folder, Rename, Lock)
        // A long press belongs to the page (the dial, details): no text selection, no link menu.
        setOnLongClickListener { true }
        isHapticFeedbackEnabled = true
        overScrollMode = View.OVER_SCROLL_NEVER
    }

    /** Atlas in the Files view: the first start signs in with the one-time code from the build, if there is one. */
    private fun loadFiles() {
        val base = server.address
        if (base.isEmpty()) { files.loadDataWithBaseURL(null, MESSAGE.replace("{m}", "Set your Atlas address in Options."), "text/html", "utf-8", null); return }
        filesReady = false
        if (!server.signedIn() && cfgPair.isNotEmpty() && !prefs.flag("pairTried")) {
            prefs.setFlag("pairTried", true); pairing = true
            files.loadUrl("$base/pair?code=" + URLEncoder.encode(cfgPair, "UTF-8"))
        } else files.loadUrl("$base/")
    }

    // ---- moving between Home and Files ----------------------------------------------------------------------
    private fun showFiles() {
        if (!showingFiles) { files.visibility = View.VISIBLE; home.visibility = View.GONE; showingFiles = true }
        files.requestFocus()
    }

    private fun goHome() {
        if (showingFiles) { files.visibility = View.GONE; home.visibility = View.VISIBLE; showingFiles = false }
        event("home")
    }

    private fun event(type: String) {
        runOnUiThread { home.evaluateJavascript("window.onLauncherEvent&&onLauncherEvent({type:${JSONObject.quote(type)}})", null) }
    }

    private fun filesJs(js: String) {
        if (filesReady) files.evaluateJavascript(js, null) else pendingFilesJs = js
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == Intent.ACTION_MAIN) goHome()                  // the Home button
    }

    @Deprecated("Back is handled here for every Android version this launcher supports")
    override fun onBackPressed() {
        // Each page uses Back for what it has open (the dial, a sheet, a folder); when it has nothing left: Files goes Home.
        val wv = if (showingFiles) files else home
        val js = if (showingFiles) "window.atlasBack?atlasBack():false" else "window.launcherBack?launcherBack():false"
        wv.evaluateJavascript(js) { r -> if (r != "true" && showingFiles) goHome() }
    }

    override fun onResume() {
        super.onResume()
        val now = apps.hasUsageAccess()
        if (now != usageWas) { usageWas = now; apps.forgetUsage(); event("apps") } else event("resume")
    }

    override fun onPause() {
        super.onPause()
        event("pause")                          // the page stops counting time for a file opened from the dial
    }

    @Deprecated("Activity results for the Home role request")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_HOME) event("resume")
    }

    private fun isDefaultHome(): Boolean = getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_HOME)

    /** Android's own question: make Atlas the default Home app? (Settings when Android won't ask again.) */
    @Suppress("DEPRECATION")
    private fun requestHome() = runOnUiThread {
        val rm = getSystemService(RoleManager::class.java)
        try {
            if (rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), REQ_HOME)
            } else startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
        } catch (e: Exception) { startActivity(Intent(Settings.ACTION_HOME_SETTINGS)) }
    }

    // ---- the home page's bridge: window.Launcher.call(id, method, json) -------------------------------------
    inner class HomeBridge {
        @JavascriptInterface
        fun call(id: Int, method: String, args: String) {
            pool.execute {
                val (ok, value) = try { true to handle(method, JSONObject(args)) } catch (e: Throwable) { false to (e.message ?: "failed") }
                val json = when (value) {
                    null, Unit -> "null"
                    is JSONObject, is JSONArray -> value.toString()
                    is String -> JSONObject.quote(value)
                    is Boolean, is Number -> value.toString()
                    else -> JSONObject.quote(value.toString())
                }
                runOnUiThread { home.evaluateJavascript("window.__native($id,$ok,${JSONObject.quote(json)})", null) }
            }
        }
    }

    private fun handle(method: String, a: JSONObject): Any? = when (method) {
        "apps" -> apps.list()
        "prefs.get" -> prefs.page()
        "prefs.set" -> {
            val key = a.getString("key"); prefs.setFromPage(key, a.opt("value"))
            if (key == "theme") {
                applyScheme()
                runOnUiThread { if (filesReady) files.evaluateJavascript("window.atlasTheme&&atlasTheme(${prefs.themeJson().ifEmpty { "null" }})", null) }
            }
            true
        }
        "launch" -> { launch(a); true }
        "appInfo" -> { apps.details(a.getString("key")); true }
        "uninstall" -> { uninstall(a.getString("key")); true }
        "server" -> {
            val (code, body) = server.text(a.getString("path"))
            JSONObject().put("status", code).put("body", body)
        }
        "serverPost" -> {
            val path = a.getString("path")
            require(path == "/settings") { "not allowed" }
            val (code, _) = server.text(path, "POST", a.getJSONObject("body").toString())
            if (code == 200 && a.getJSONObject("body").has("tone"))
                runOnUiThread { filesJs("typeof applyTone==='function'&&applyTone(${JSONObject.quote(a.getJSONObject("body").getString("tone"))})") }
            code
        }
        "files.show" -> { runOnUiThread { showFiles() }; true }
        "files.open" -> {
            val js = "window.atlasOpen&&atlasOpen(${JSONObject.quote(a.getString("path"))},${a.optBoolean("dir")})"
            runOnUiThread { showFiles(); filesJs(js) }; true
        }
        "haptic" -> { runOnUiThread { haptic(home, a.optString("k")) }; true }
        "usage.request" -> { runOnUiThread { openUsageSettings() }; true }
        "home.request" -> { requestHome(); true }
        "quit" -> { quit(); true }
        "info" -> JSONObject().put("version", BuildConfig.VERSION_NAME).put("code", BuildConfig.VERSION_CODE)
            .put("server", server.address).put("isDefault", isDefaultHome()).put("usage", apps.hasUsageAccess()).put("signedIn", server.signedIn())
        "pair" -> { pair(a.getString("code"), a.optString("server")); true }
        "update.check" -> checkUpdate()
        "update.install" -> { installUpdate(); true }
        "ready" -> {
            if (!prefs.flag("askedHome") && !isDefaultHome()) { prefs.setFlag("askedHome", true); requestHome() }
            true
        }
        else -> throw IllegalArgumentException("unknown request $method")
    }

    private fun launch(a: JSONObject) {
        val key = a.getString("key")
        runOnUiThread {
            try {
                val d = resources.displayMetrics.density; val loc = IntArray(2); home.getLocationOnScreen(loc)
                val x = (a.optDouble("x", 0.0) * d).roundToInt(); val y = (a.optDouble("y", 0.0) * d).roundToInt()
                val w = (a.optDouble("w", 0.0) * d).roundToInt(); val h = (a.optDouble("h", 0.0) * d).roundToInt()
                val bounds = if (w > 0 && h > 0) Rect(loc[0] + x, loc[1] + y, loc[0] + x + w, loc[1] + y + h) else null
                val opts = if (bounds != null) ActivityOptions.makeScaleUpAnimation(home, x, y, w, h).toBundle() else null
                apps.launch(key, bounds, opts)
            } catch (e: Exception) { Toast.makeText(this, "Couldn't open it: " + (e.message ?: "unknown error"), Toast.LENGTH_SHORT).show() }
        }
    }

    private fun uninstall(key: String) = runOnUiThread {
        if (apps.isWork(key)) { apps.details(key); return@runOnUiThread }       // work apps are removed from their own settings
        val pkg = key.substringBefore('/')
        startActivity(Intent(Intent.ACTION_DELETE, Uri.fromParts("package", pkg, null)))
    }

    private fun openUsageSettings() {
        try { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName"))) }
        catch (e: Exception) { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
    }

    private fun haptic(v: View, kind: String) {
        v.performHapticFeedback(if (kind == "tick") HapticFeedbackConstants.CLOCK_TICK else HapticFeedbackConstants.LONG_PRESS)
    }

    private fun pair(code: String, address: String) = runOnUiThread {
        if (address.startsWith("https://")) prefs.setString("server", address.trimEnd('/'))
        val base = server.address
        if (base.isEmpty()) { Toast.makeText(this, "Set your Atlas address first", Toast.LENGTH_SHORT).show(); return@runOnUiThread }
        pairing = true; filesReady = false
        showFiles()
        files.loadUrl("$base/pair?code=" + URLEncoder.encode(code.trim(), "UTF-8"))
    }

    // ---- Atlas's bridge in the Files view: window.AtlasLauncher -----------------------------------------------
    inner class FilesBridge {
        @JavascriptInterface fun home() { runOnUiThread { goHome() } }
        @JavascriptInterface fun haptic(kind: String) { runOnUiThread { haptic(files, kind) } }
        @JavascriptInterface fun isPinned(path: String): Boolean = prefs.isPinnedFile(path)
        @JavascriptInterface fun theme(): String = prefs.themeJson()
        @JavascriptInterface fun pin(json: String): String {
            val r = prefs.togglePinFile(JSONObject(json))
            if (r != "full") event("pins")
            return r
        }
    }

    // ---- the two pages' traffic -------------------------------------------------------------------------------
    /** The home page: its own files from the app, icons from Android, Atlas data through [Server]. Nothing else. */
    inner class HomeClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.host != ASSETS

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val u = request.url
            if (u.host != ASSETS) return status(403)
            val path = u.path ?: "/"
            return when {
                path == "/native/icon" -> apps.iconPng(u.getQueryParameter("k") ?: "", iconPx)
                    ?.let { WebResourceResponse("image/png", null, 200, "OK", mapOf("Cache-Control" to "max-age=600"), ByteArrayInputStream(it)) }
                    ?: status(404)
                path.startsWith("/native/server/") && request.method == "GET" -> proxy(path.removePrefix("/native/server") + (u.encodedQuery?.let { "?$it" } ?: ""))
                else -> asset(path)
            }
        }
    }

    private fun status(code: Int) = WebResourceResponse("text/plain", "utf-8", code, if (code == 404) "Not Found" else "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun asset(path: String): WebResourceResponse {
        val rel = if (path == "/" || path.isEmpty()) "index.html" else path.removePrefix("/")
        if (rel.split('/').any { it == ".." || it.isEmpty() }) return status(404)
        val mime = when (rel.substringAfterLast('.', "")) {
            "html" -> "text/html"; "js" -> "text/javascript"; "css" -> "text/css"; "json" -> "application/json"
            "woff2" -> "font/woff2"; "png" -> "image/png"; "svg" -> "image/svg+xml"; else -> "application/octet-stream"
        }
        return try {
            WebResourceResponse(mime, if (mime.startsWith("text/") || mime == "application/json") "utf-8" else null, 200, "OK",
                mapOf("Cache-Control" to "no-cache"), assets.open("web/$rel"))
        } catch (e: Exception) { status(404) }
    }

    private fun proxy(path: String): WebResourceResponse = try {
        val c = server.open(path)
        if (c.responseCode != 200) { c.disconnect(); status(404) }
        else WebResourceResponse(c.contentType?.substringBefore(';') ?: "application/octet-stream", null, 200, "OK",
            mapOf("Cache-Control" to "private, max-age=3600"), c.inputStream)
    } catch (e: Exception) { status(404) }

    /** Atlas in the Files view: pages from your Atlas address only; any other link opens in its own app. */
    inner class FilesClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val u = request.url
            if (u.scheme == "https" && u.host == Uri.parse(server.address).host) return false
            try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
            return true
        }

        override fun onPageFinished(view: WebView, url: String) {
            view.evaluateJavascript("typeof window.atlasOpen") { r ->
                filesReady = r == "\"function\""
                if (filesReady) {
                    CookieManager.getInstance().flush()
                    pendingFilesJs?.let { files.evaluateJavascript(it, null) }; pendingFilesJs = null
                    if (pairing) { pairing = false; event("paired") }
                }
            }
        }
    }

    private fun download(url: String, ua: String, disposition: String?, mime: String?) {
        try {
            val name = URLUtil.guessFileName(url, disposition, mime)
            val req = DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", ua)
                .setTitle(name).setMimeType(mime)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            getSystemService(DownloadManager::class.java).enqueue(req)
            Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) { Toast.makeText(this, "Couldn't download it", Toast.LENGTH_SHORT).show() }
    }

    // ---- new versions, from your Atlas server ---------------------------------------------------------------
    private fun checkUpdate(): JSONObject {
        val (code, body) = server.text("/launcher/latest.json")
        if (code == 401) throw IllegalStateException("sign in to Atlas first")
        if (code != 200) throw IllegalStateException(if (code == 0) "can't reach Atlas" else "there is no launcher build on Atlas")
        val j = JSONObject(body); latest = j
        return JSONObject().put("available", j.optInt("code") > BuildConfig.VERSION_CODE).put("version", j.optString("version")).put("notes", j.optString("notes"))
    }

    private fun installUpdate() {
        val j = latest ?: JSONObject(server.text("/launcher/latest.json").second)
        if (!packageManager.canRequestPackageInstalls()) {
            runOnUiThread {
                Toast.makeText(this, "Allow Atlas to install its updates, then tap Update again", Toast.LENGTH_LONG).show()
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            }
            return
        }
        val f = File(cacheDir, "atlas-launcher.apk")
        val c = server.open("/launcher/atlas-launcher.apk")
        try {
            if (c.responseCode != 200) throw IllegalStateException("Atlas answered " + c.responseCode)
            c.inputStream.use { input -> f.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
        val want = j.optString("sha256").lowercase()
        if (want.isNotEmpty() && sha256(f) != want) { f.delete(); throw IllegalStateException("the download was damaged; try again") }
        val installer = packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("atlas-launcher.apk", 0, f.length()).use { out -> f.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val done = PendingIntent.getBroadcast(this, id, Intent(this, InstallReceiver::class.java).setPackage(packageName), flags)
            s.commit(done.intentSender)
        }
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input -> val buf = ByteArray(1 shl 16); while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}

private const val MESSAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="background:#000;color:#F3F1EC;font:16px/1.5 sans-serif;display:grid;place-items:center;min-height:90vh;margin:0">
<p style="max-width:28rem;padding:24px;color:#8E9096">{m}</p>"""
