package com.vittorionetti.atlas.launcher

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityOptions
import android.app.DownloadManager
import android.app.PendingIntent
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.ClipData
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
import java.util.concurrent.atomic.AtomicBoolean
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
    private var contactsWas = false
    private val contacts by lazy { Contacts(this) }
    private var pendingCall: String? = null
    private val where by lazy { Where(this, prefs) }
    private var placeWas = false
    private val calendar by lazy { PhoneCalendar(this) }
    private var calendarWas = false
    @Volatile private var filesTheme: String? = null          // Sun mode: the sky for Atlas in Files, sent by the home page
    private var filesThemeDirty = false
    private var latest: JSONObject? = null
    private var latestDir: String? = null       // where the newest build is: null for the server, else the drive folder
    private var cfgServer = ""
    private var cfgPair = ""
    private var cfgUpdates = ""
    private val iconPx get() = (48 * resources.displayMetrics.density).roundToInt().coerceIn(96, 192)

    companion object {
        const val ASSETS = "appassets.androidplatform.net"
        private val IVORY = Color.rgb(0xF2, 0xEB, 0xD8)             // the page's ivory (launcher.css)
        private const val REQ_HOME = 41
        private const val REQ_CONTACTS = 42
        private const val REQ_CALL = 43
        private const val REQ_PLACE = 44
        private const val REQ_CALENDAR = 45
    }

    // ---- start ---------------------------------------------------------------------------------------------
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        prefs = Prefs(this)
        apps = Apps(this, prefs)
        try {
            val j = JSONObject(assets.open("launcher.json").bufferedReader().use { it.readText() })
            cfgServer = j.optString("server").trimEnd('/'); cfgPair = j.optString("pair"); cfgUpdates = j.optString("updates").trimEnd('\\')
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
        contactsWas = contacts.allowed()
        placeWas = where.allowed()
        calendarWas = calendar.allowed()
        if (calendarWas) calendar.listen { event("calendar") }
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
        if (filesThemeDirty) pushFilesTheme()
        event("home")
    }

    /**
     * Atlas in Files takes the launcher's color: the saved one, or in Sun mode the sky the home page sends now and then
     * ("files.theme"). Atlas redraws its map for it, so while Files is in front the color waits until you go Home.
     */
    private fun pushFilesTheme() = runOnUiThread {
        if (!filesReady || showingFiles) { filesThemeDirty = true; return@runOnUiThread }
        filesThemeDirty = false
        files.evaluateJavascript("window.atlasTheme&&atlasTheme(${filesThemeJson().ifEmpty { "null" }})", null)
    }

    private fun filesThemeJson(): String = filesTheme ?: prefs.themeJson()

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
        if (contacts.allowed() != contactsWas) { contactsWas = !contactsWas; event("contacts") }   // allowed or taken back in Settings
        if (where.allowed() != placeWas) { placeWas = !placeWas; event("place") }
        if (calendar.allowed() != calendarWas) {                              // allowed or taken back in Settings
            calendarWas = !calendarWas
            if (calendarWas) calendar.listen { event("calendar") }
            event("calendar")
        }
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
            if (key == "theme") { applyScheme(); pushFilesTheme() }
            true
        }
        "files.theme" -> {                               // Sun mode: the sky as a gradient, or null to go back to the saved color
            val t = a.optJSONObject("theme")?.toString()
            if (t != filesTheme) { filesTheme = t; pushFilesTheme() }
            true
        }
        "place.get" -> {                                 // Sun mode: the kept place now; a fresher one comes as the "place" event
            where.refresh(if (a.optBoolean("fresh")) 10 * 60_000L else 3 * 3_600_000L) { event("place") }
            where.json()
        }
        "place.allow" -> { askPlace(a.optBoolean("auto")); true }
        "launch" -> { launch(a); true }
        "appInfo" -> { apps.details(a.getString("key")); true }
        "uninstall" -> { uninstall(a.getString("key")); true }
        "server" -> {
            val post = a.optString("method").equals("POST", true)          // a change, such as Pause in the Claude panel
            val (code, body) = server.text(a.getString("path"), if (post) "POST" else "GET", if (post) a.optString("body", "{}") else null)
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
            .put("calendar", calendar.allowed())
        "pair" -> { pair(a.getString("code"), a.optString("server")); true }
        "web.search" -> { webSearch(a.getString("q")); true }
        "web.suggest" -> suggest(a.getString("q"))
        "contacts.search" -> JSONObject().put("allowed", contacts.allowed()).put("contacts", contacts.search(a.optString("q")))
        "contacts.allow" -> { askContacts(); true }
        "contacts.open" -> { openContact(a); true }
        "cal.list" -> calendar.list().also { if (calendar.allowed()) calendar.listen { event("calendar") } }
        "cal.events" -> calendar.events(a.getInt("from"), a.getInt("to"))
        "cal.event" -> calendar.event(a.getLong("id"))
        "cal.allow" -> { askCalendar(a.optBoolean("auto")); true }
        "cal.respond" -> calendar.respond(a.getLong("id"), a.optLong("begin"), a.getInt("status"), a.optBoolean("one"))
        "cal.create" -> calendar.create(a)
        "cal.show" -> calendar.show(a.getLong("id"))
        "cal.sync" -> calendar.sync()
        "cal.open" -> { calOpen(a); true }
        "cal.go" -> { go(a); true }
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
        @JavascriptInterface fun theme(): String = filesThemeJson()
        @JavascriptInterface fun pin(json: String): String {
            val r = prefs.togglePinFile(JSONObject(json))
            if (r != "full") event("pins")
            return r
        }
        /** Holding a file, or Open in app in the viewer: the file in the phone's own app for its kind. */
        @JavascriptInterface fun openWith(json: String): Boolean { fetchFile(JSONObject(json), share = false); return true }
        /** Share in the viewer: Android's share sheet with the file. */
        @JavascriptInterface fun share(json: String): Boolean { fetchFile(JSONObject(json), share = true); return true }
    }

    // ---- Google from the search bar ------------------------------------------------------------------------------
    /** Google's results for q, in the browser (Chrome, or whichever app the phone uses for web pages). */
    private fun webSearch(q: String) {
        val uri = Uri.parse("https://www.google.com/search?q=" + URLEncoder.encode(q.trim(), "UTF-8"))
        runOnUiThread {
            try { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
            catch (e: ActivityNotFoundException) { Toast.makeText(this, "No app on this phone opens web pages.", Toast.LENGTH_SHORT).show() }
        }
    }

    // ---- contacts in the search (1.3.0): see Contacts.kt --------------------------------------------------------
    /** Android asks once (and once more after a no); after that only the app's settings can allow it, so they open. */
    private fun askContacts() = runOnUiThread {
        if (!prefs.flag("askedContacts") || shouldShowRequestPermissionRationale(Manifest.permission.READ_CONTACTS)) {
            prefs.setFlag("askedContacts", true)
            requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQ_CONTACTS)
        } else startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    // ---- Sun mode (1.4.0): where the phone is, roughly; see Where.kt -------------------------------------------
    /** Picking Sun asks Android, if Android still will (once, and once more after a no); Allow location asks too, and
     *  opens the app's settings when Android won't ask any more. Allowed already: a fresh place. */
    private fun askPlace(auto: Boolean) = runOnUiThread {
        if (where.allowed()) { where.refresh(10 * 60_000L) { event("place") }; return@runOnUiThread }
        if (!prefs.flag("askedPlace") || shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            prefs.setFlag("askedPlace", true)
            requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION), REQ_PLACE)
        } else if (!auto) startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    // ---- the calendar (1.6.0): see PhoneCalendar.kt ---------------------------------------------------------------------
    /** The first swipe right asks Android (once, and once more after a no); Allow calendars asks too, and opens the app's
     *  settings when Android won't ask any more. Reading and writing the calendar are one question on Android. */
    private fun askCalendar(auto: Boolean) = runOnUiThread {
        if (calendar.allowed() && calendar.canWrite()) { event("calendar"); return@runOnUiThread }
        if (!prefs.flag("askedCalendar") || shouldShowRequestPermissionRationale(Manifest.permission.READ_CALENDAR)) {
            prefs.setFlag("askedCalendar", true)
            requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR), REQ_CALENDAR)
        } else if (!auto) startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    /** An event in the phone's calendar app (to see it or edit it), a new one there, or a day; a work event in the work profile's. */
    private fun calOpen(a: JSONObject) = runOnUiThread {
        val kind = a.optString("kind")
        if (kind == "work") {
            val opened = calendar.openWork(a.optLong("id"), a.optLong("begin"), a.optLong("end"), a.optBoolean("allDay"))
            if (!opened) Toast.makeText(this, "The work profile has no calendar app that opens events from here.", Toast.LENGTH_LONG).show()
            return@runOnUiThread
        }
        try {
            startActivity(when (kind) {
                "insert" -> calendar.insertIntent(a)
                "day" -> calendar.dayIntent(a.optLong("at", System.currentTimeMillis()))
                else -> calendar.viewIntent(a.getLong("id"), a.optLong("begin"), a.optLong("end"), kind == "edit")
            })
        } catch (e: ActivityNotFoundException) { Toast.makeText(this, "No calendar app on this phone opens that.", Toast.LENGTH_SHORT).show() }
        catch (e: Exception) { Toast.makeText(this, "Couldn't open it: " + (e.message ?: "unknown error"), Toast.LENGTH_SHORT).show() }
    }

    /** A link from an event (Join, a link in its notes) in its own app or the browser, or its place in the phone's maps. */
    private fun go(a: JSONObject) {
        val place = a.optString("place")
        val uri = if (place.isNotBlank()) Uri.parse("geo:0,0?q=" + Uri.encode(place)) else Uri.parse(a.getString("url"))
        require(uri.scheme in setOf("https", "http", "geo", "mailto", "tel")) { "not a link" }
        runOnUiThread {
            val i = Intent(Intent.ACTION_VIEW, uri)
            if (uri.scheme == "https" || uri.scheme == "http") i.addCategory(Intent.CATEGORY_BROWSABLE)
            try { startActivity(i) }
            catch (e: ActivityNotFoundException) { Toast.makeText(this, "No app on this phone opens that.", Toast.LENGTH_SHORT).show() }
        }
    }

    private fun openContact(a: JSONObject) {
        if (a.optString("kind") == "call") { placeCall(a.getString("number")); return }
        val i = contacts.intent(a) ?: return
        runOnUiThread {
            try { startActivity(i) }
            catch (e: ActivityNotFoundException) { Toast.makeText(this, "No app on this phone opens that.", Toast.LENGTH_SHORT).show() }
            catch (e: SecurityException) { Toast.makeText(this, "That app said no: " + (e.message ?: "no reason given"), Toast.LENGTH_SHORT).show() }
        }
    }

    /** Phone under a contact calls at once. The first time Android asks to allow calls; without that, the dialer opens. */
    private fun placeCall(number: String) = runOnUiThread {
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) startCall(number, true)
        else { pendingCall = number; requestPermissions(arrayOf(Manifest.permission.CALL_PHONE), REQ_CALL) }
    }

    private fun startCall(number: String, direct: Boolean) {
        try { startActivity(Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))) }
        catch (e: Exception) { Toast.makeText(this, "Couldn't call: " + (e.message ?: "unknown error"), Toast.LENGTH_SHORT).show() }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        when (requestCode) {
            REQ_CONTACTS -> { contactsWas = contacts.allowed(); event("contacts") }
            REQ_CALL -> pendingCall?.let { n -> pendingCall = null; startCall(n, ok) }
            REQ_PLACE -> { placeWas = where.allowed(); if (ok) where.refresh(0L) { event("place") }; event("place") }
            REQ_CALENDAR -> { calendarWas = calendar.allowed(); if (calendarWas) calendar.listen { event("calendar") }; event("calendar") }
        }
    }

    /** Google's suggestions for what is typed so far, as its own search box shows them: up to five. */
    private fun suggest(q: String): JSONArray {
        val out = JSONArray()
        if (q.isBlank()) return out
        val url = java.net.URL("https://suggestqueries.google.com/complete/search?client=firefox&oe=utf-8&hl=" +
            URLEncoder.encode(java.util.Locale.getDefault().language, "UTF-8") + "&q=" + URLEncoder.encode(q, "UTF-8"))
        val c = url.openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 3000; c.readTimeout = 3000
        try {
            if (c.responseCode != 200) return out
            val list = JSONArray(c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }).optJSONArray(1) ?: return out
            for (i in 0 until minOf(5, list.length())) out.put(list.optString(i))
        } finally {
            c.disconnect()
        }
        return out
    }

    // ---- a file from Atlas in another app -----------------------------------------------------------------------
    // The file comes from Atlas with this launcher's sign-in into the app's cache, then goes to the other app through
    // SharedFiles, read only. Atlas's page hears how it goes through window.atlasFile: progress, done or an error.
    private val fetching = AtomicBoolean(false)

    private fun fileState(state: String, name: String, pct: Int = 0, msg: String = "") {
        val j = JSONObject().put("state", state).put("name", name).put("pct", pct).put("msg", msg)
        runOnUiThread { filesJs("window.atlasFile&&atlasFile($j)") }
    }

    private fun safeName(n: String): String {
        val s = n.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimStart('.').ifEmpty { "file" }
        if (s.length <= 120) return s
        val ext = s.substringAfterLast('.', "").take(10)
        return s.take(110) + if (ext.isNotEmpty()) ".$ext" else ""
    }

    private fun fetchFile(item: JSONObject, share: Boolean) {
        val path = item.optString("path")
        if (path.isEmpty()) return
        val name = safeName(item.optString("name").ifEmpty { path.substringAfterLast('\\') })
        if (!fetching.compareAndSet(false, true)) { fileState("error", name, msg = "One file at a time: another one is on its way."); return }
        pool.execute {
            try {
                val f = fetchToCache(path, name) { fileState("progress", name, it) }
                runOnUiThread {
                    fileState("done", name)
                    val uri = SharedFiles.uri(f); val type = SharedFiles.mime(name)
                    try {
                        if (share) {
                            val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            send.clipData = ClipData.newRawUri(name, uri)
                            startActivity(Intent.createChooser(send, "Share $name"))
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        }
                    } catch (e: ActivityNotFoundException) {
                        fileState("error", name, msg = "No app on this phone opens this kind of file.")
                    }
                }
            } catch (e: Exception) {
                fileState("error", name, msg = "Couldn't get $name: ${e.message ?: "Atlas can't be reached"}")
            } finally {
                fetching.set(false)
            }
        }
    }

    private fun fetchToCache(path: String, name: String, progress: (Int) -> Unit): File {
        val root = SharedFiles.dir(this)
        root.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000L) it.deleteRecursively() }
        val key = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
        val dir = File(root, key).apply { mkdirs() }
        val out = File(dir, name)
        val c = server.open("/api/file?path=" + URLEncoder.encode(path, "UTF-8") + "&dl=1")
        c.readTimeout = 120_000
        try {
            val code = c.responseCode
            if (code != 200) {
                val err = c.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                throw java.io.IOException(runCatching { JSONObject(err).optString("error") }.getOrNull()?.ifEmpty { null } ?: "Atlas answered $code")
            }
            val total = c.contentLengthLong
            val tmp = File(dir, "$name.part")
            var got = 0L; var shown = -1; var last = 0L
            c.inputStream.use { inp ->
                tmp.outputStream().use { o ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        o.write(buf, 0, n); got += n
                        val now = System.currentTimeMillis()
                        if (total > 0 && now - last > 300) {
                            val pct = (got * 100 / total).toInt()
                            if (pct != shown) { shown = pct; last = now; progress(pct) }
                        }
                    }
                }
            }
            if (total > 0 && got != total) { tmp.delete(); throw java.io.IOException("the file didn't arrive whole, try again") }
            out.delete()
            if (!tmp.renameTo(out)) throw java.io.IOException("no room on the phone")
            dir.setLastModified(System.currentTimeMillis())
            return out
        } finally {
            c.disconnect()
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
                    if (filesThemeDirty) pushFilesTheme()
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

    // ---- new versions: from your Atlas server, or from the updates folder in your cloud drive ---------------------
    // Two places, and the newer build wins: the server's own launcher_dist (/launcher/...), and launcher.json's "updates"
    // folder in the cloud drive (for example G:\\My Drive\\.atlas\\launcher), read through Atlas like any other file. The
    // second needs nothing copied onto the server: build.ps1 puts each build there. Android installs only an update
    // signed with the same key, and the download must match latest.json's sha256.
    private fun checkUpdate(): JSONObject {
        val (code, body) = server.text("/launcher/latest.json")
        if (code == 401) throw IllegalStateException("sign in to Atlas first")
        if (code == 0) throw IllegalStateException("can't reach Atlas")
        var best: JSONObject? = if (code == 200) runCatching { JSONObject(body) }.getOrNull() else null
        var from: String? = null
        if (cfgUpdates.isNotEmpty()) {
            val (c2, b2) = server.text("/api/text?path=" + Uri.encode("$cfgUpdates\\latest.json"))
            val d = if (c2 == 200) runCatching { JSONObject(JSONObject(b2).optString("text")) }.getOrNull() else null
            if (d != null && (best == null || d.optInt("code") > best.optInt("code"))) { best = d; from = cfgUpdates }
        }
        val j = best ?: throw IllegalStateException("there is no launcher build on Atlas")
        latest = j; latestDir = from
        return JSONObject().put("available", j.optInt("code") > BuildConfig.VERSION_CODE).put("version", j.optString("version")).put("notes", j.optString("notes"))
    }

    private fun installUpdate() {
        if (latest == null) checkUpdate()
        val j = latest ?: throw IllegalStateException("there is no launcher build on Atlas")
        if (!packageManager.canRequestPackageInstalls()) {
            runOnUiThread {
                Toast.makeText(this, "Allow Atlas to install its updates, then tap Update again", Toast.LENGTH_LONG).show()
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            }
            return
        }
        val f = File(cacheDir, "atlas-launcher.apk")
        val dir = latestDir
        val c = server.open(if (dir != null) "/api/file?path=" + Uri.encode("$dir\\atlas-launcher.apk") else "/launcher/atlas-launcher.apk")
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
