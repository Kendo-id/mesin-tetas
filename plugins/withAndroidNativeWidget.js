/**
 * withAndroidNativeWidget.js — TerraBreed homescreen widgets v3
 * Widgets: Sensor (Suhu+Lembap+MiniChart), Inkubasi, TERRA AI
 *
 * Fix v3:
 *  - Widget Suhu & Kelembapan digabung → TbSensorWidget + mini bar chart
 *  - Widget AI: resizeMode=horizontal (tinggi dikunci 1 cell)
 *  - Widget AI klik: SINGLE_TOP → CLEAR_TOP agar deep-link diproses ulang
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function writeFile(p, c) { ensureDir(path.dirname(p)); fs.writeFileSync(p, c, 'utf8'); }

// ── Drawables ─────────────────────────────────────────────────────────────────
const TB_WIDGET_BG = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#B30F172A"/>
    <corners android:radius="16dp"/>
</shape>`;

const TB_AI_INPUT_BG = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FF1E293B"/>
    <corners android:radius="21dp"/>
    <stroke android:width="1dp" android:color="#334155"/>
</shape>`;

const TB_MIC_BTN_BG = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#F59E0B"/>
</shape>`;

const TB_CHART_TEMP = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:id="@android:id/background">
        <shape android:shape="rectangle">
            <solid android:color="#1E293B"/>
            <corners android:radius="3dp"/>
        </shape>
    </item>
    <item android:id="@android:id/progress">
        <clip>
            <shape android:shape="rectangle">
                <solid android:color="#F59E0B"/>
                <corners android:radius="3dp"/>
            </shape>
        </clip>
    </item>
</layer-list>`;

const TB_CHART_HUMID = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:id="@android:id/background">
        <shape android:shape="rectangle">
            <solid android:color="#1E293B"/>
            <corners android:radius="3dp"/>
        </shape>
    </item>
    <item android:id="@android:id/progress">
        <clip>
            <shape android:shape="rectangle">
                <solid android:color="#38BDF8"/>
                <corners android:radius="3dp"/>
            </shape>
        </clip>
    </item>
</layer-list>`;

// ── Layouts ───────────────────────────────────────────────────────────────────
function layoutSensor() {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:background="@drawable/tb_widget_bg"
    android:paddingStart="14dp" android:paddingEnd="14dp"
    android:paddingTop="10dp" android:paddingBottom="10dp"
    android:gravity="center_vertical">

    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:gravity="center_vertical">
        <LinearLayout android:layout_width="0dp" android:layout_height="wrap_content"
            android:layout_weight="1" android:orientation="vertical">
            <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
                android:text="SUHU" android:textColor="#64748B" android:textSize="9sp"
                android:letterSpacing="0.08"/>
            <TextView android:id="@+id/tb_temp_value"
                android:layout_width="wrap_content" android:layout_height="wrap_content"
                android:text="--&#176;C" android:textColor="#F59E0B"
                android:textSize="22sp" android:textStyle="bold"/>
        </LinearLayout>
        <TextView android:layout_width="1dp" android:layout_height="32dp"
            android:background="#1E293B" android:layout_marginEnd="10dp"
            android:text=""/>
        <LinearLayout android:layout_width="0dp" android:layout_height="wrap_content"
            android:layout_weight="1" android:orientation="vertical">
            <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
                android:text="LEMBAP" android:textColor="#64748B" android:textSize="9sp"
                android:letterSpacing="0.08"/>
            <TextView android:id="@+id/tb_humid_value"
                android:layout_width="wrap_content" android:layout_height="wrap_content"
                android:text="--%  " android:textColor="#38BDF8"
                android:textSize="22sp" android:textStyle="bold"/>
        </LinearLayout>
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:gravity="center_vertical"
        android:layout_marginTop="8dp">
        <TextView android:layout_width="20dp" android:layout_height="wrap_content"
            android:text="T" android:textColor="#F59E0B" android:textSize="9sp" android:textStyle="bold"/>
        <ProgressBar android:id="@+id/tb_chart_temp"
            style="?android:attr/progressBarStyleHorizontal"
            android:layout_width="0dp" android:layout_height="6dp"
            android:layout_weight="1"
            android:progressDrawable="@drawable/tb_chart_temp"
            android:max="1000" android:progress="500"/>
        <TextView android:id="@+id/tb_chart_temp_label"
            android:layout_width="36dp" android:layout_height="wrap_content"
            android:text="--" android:textColor="#94A3B8" android:textSize="9sp"
            android:gravity="end"/>
    </LinearLayout>

    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:gravity="center_vertical"
        android:layout_marginTop="4dp">
        <TextView android:layout_width="20dp" android:layout_height="wrap_content"
            android:text="H" android:textColor="#38BDF8" android:textSize="9sp" android:textStyle="bold"/>
        <ProgressBar android:id="@+id/tb_chart_humid"
            style="?android:attr/progressBarStyleHorizontal"
            android:layout_width="0dp" android:layout_height="6dp"
            android:layout_weight="1"
            android:progressDrawable="@drawable/tb_chart_humid"
            android:max="1000" android:progress="600"/>
        <TextView android:id="@+id/tb_chart_humid_label"
            android:layout_width="36dp" android:layout_height="wrap_content"
            android:text="--" android:textColor="#94A3B8" android:textSize="9sp"
            android:gravity="end"/>
    </LinearLayout>

    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="TerraBreed" android:textColor="#334155" android:textSize="8sp"
        android:layout_marginTop="4dp"/>
</LinearLayout>`;
}

function layoutIncubation() {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:background="@drawable/tb_widget_bg"
    android:paddingStart="18dp" android:paddingEnd="18dp"
    android:paddingTop="14dp" android:paddingBottom="14dp"
    android:gravity="center_vertical">
    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="INKUBASI" android:textColor="#64748B" android:textSize="10sp"
        android:letterSpacing="0.08"/>
    <TextView android:id="@+id/tb_incub_day"
        android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Tidak ada sesi"
        android:textColor="#22C55E" android:textSize="22sp" android:textStyle="bold"/>
    <TextView android:id="@+id/tb_incub_species"
        android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="TerraBreed" android:textColor="#E2E8F0" android:textSize="12sp"/>
    <TextView android:id="@+id/tb_incub_sensor"
        android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="" android:textColor="#64748B" android:textSize="10sp"
        android:layout_marginTop="2dp"/>
</LinearLayout>`;
}

function layoutAi() {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="horizontal"
    android:background="@drawable/tb_widget_bg"
    android:paddingStart="10dp" android:paddingEnd="10dp"
    android:paddingTop="10dp" android:paddingBottom="10dp"
    android:gravity="center_vertical">

    <LinearLayout android:id="@+id/tb_ai_input"
        android:layout_width="0dp" android:layout_height="42dp"
        android:layout_weight="1"
        android:background="@drawable/tb_ai_input_bg"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:paddingStart="12dp" android:paddingEnd="8dp"
        android:layout_marginEnd="8dp">
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:text="&#10024;" android:textColor="#F59E0B" android:textSize="12sp"
            android:layout_marginEnd="6dp"/>
        <TextView android:layout_width="0dp" android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="Tanya TERRA AI..."
            android:textColor="#64748B" android:textSize="13sp"
            android:singleLine="true"/>
    </LinearLayout>

    <TextView android:id="@+id/tb_ai_mic"
        android:layout_width="42dp" android:layout_height="42dp"
        android:background="@drawable/tb_mic_btn_bg"
        android:text="&#127908;"
        android:textSize="18sp"
        android:gravity="center"/>
</LinearLayout>`;
}

// ── AppWidget info XMLs ───────────────────────────────────────────────────────
// horizontal only → tinggi dikunci (tidak bisa di-resize vertikal)
function widgetInfoH(layout, minW, minH, cellW, cellH) {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="${minW}dp" android:minHeight="${minH}dp"
    android:targetCellWidth="${cellW}" android:targetCellHeight="${cellH}"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/${layout}"
    android:resizeMode="horizontal"
    android:widgetCategory="home_screen"/>`;
}

// horizontal|vertical → bisa resize bebas
function widgetInfoHV(layout, minW, minH, cellW, cellH) {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="${minW}dp" android:minHeight="${minH}dp"
    android:targetCellWidth="${cellW}" android:targetCellHeight="${cellH}"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/${layout}"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"/>`;
}

// ── Kotlin: TbWidgetApi ───────────────────────────────────────────────────────
function ktApi(pkg, serverUrl) { return `package ${pkg}

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.*

object TbWidgetApi {
    private const val DEFAULT_URL = "${serverUrl}"
    private const val PREFS_NAME  = "TerraBreedWidget"
    private const val KEY_URL     = "server_url"
    private const val AS_KEY      = "server_base_url"

    private val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
        override fun checkClientTrusted(c: Array<X509Certificate>, a: String) {}
        override fun checkServerTrusted(c: Array<X509Certificate>, a: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    })
    private val sslCtx: SSLContext by lazy {
        SSLContext.getInstance("TLS").also { it.init(null, trustAll, SecureRandom()) }
    }
    private val allVerifier = HostnameVerifier { _, _ -> true }

    private fun readUrlFromAsyncStorage(ctx: Context): String? {
        val dbDir = File(ctx.applicationInfo.dataDir, "databases")
        for (name in listOf("AsyncStorage", "RKStorage", "default", "asyncstorage")) {
            val f = File(dbDir, name)
            if (!f.exists()) continue
            try {
                SQLiteDatabase.openDatabase(f.path, null,
                    SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use { db ->
                    for (tbl in listOf("catalystLocalStorage", "AsyncStorage", "keyvalue")) {
                        try {
                            db.rawQuery("SELECT value FROM \$tbl WHERE key=?", arrayOf(AS_KEY)).use { c ->
                                if (c.moveToFirst()) {
                                    val v = c.getString(0)
                                    if (!v.isNullOrBlank()) return v.trim('"').trimEnd('/')
                                }
                            }
                        } catch (_: Exception) {}
                    }
                }
            } catch (_: Exception) {}
        }
        val legacy = ctx.getSharedPreferences("RCTDefaultPreferences", Context.MODE_PRIVATE)
        return legacy.getString(AS_KEY, null)?.trimEnd('/')
    }

    fun getServerUrl(ctx: Context): String {
        return runCatching { readUrlFromAsyncStorage(ctx) }.getOrNull()?.takeIf { it.isNotBlank() }
            ?: ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_URL, DEFAULT_URL)
            ?: DEFAULT_URL
    }

    data class SensorData(val temperature: Double?, val humidity: Double?)
    data class IncubationData(
        val dayNumber: Int?, val totalDays: Int?, val species: String?,
        val temperature: Double?, val humidity: Double?
    )

    private fun JSONObject.getTemp(): Double? {
        for (k in listOf("temp", "temperature", "suhu")) {
            if (has(k)) { val v = optDouble(k); if (!v.isNaN()) return v }
        }; return null
    }
    private fun JSONObject.getHumid(): Double? {
        for (k in listOf("humidity", "lembab", "humid")) {
            if (has(k)) { val v = optDouble(k); if (!v.isNaN()) return v }
        }; return null
    }

    private fun openConn(url: String, ms: Int = 8000): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = ms; c.readTimeout = ms
        c.requestMethod = "GET"
        c.setRequestProperty("Accept", "application/json")
        if (c is HttpsURLConnection) {
            c.sslSocketFactory = sslCtx.socketFactory
            c.hostnameVerifier = allVerifier
        }
        return c
    }

    fun fetchSensor(ctx: Context): SensorData? {
        return try {
            val c = openConn(getServerUrl(ctx).trimEnd('/') + "/api/sensor/latest")
            if (c.responseCode != 200) { c.disconnect(); null }
            else {
                val root = JSONObject(InputStreamReader(c.inputStream).readText().also { c.disconnect() })
                val obj  = root.optJSONObject("sensor") ?: root.optJSONObject("data") ?: root
                SensorData(obj.getTemp(), obj.getHumid())
            }
        } catch (_: Exception) { null }
    }

    fun fetchIncubation(ctx: Context): IncubationData? {
        return try {
            val c = openConn(getServerUrl(ctx).trimEnd('/') + "/api/incubation/current")
            if (c.responseCode != 200) { c.disconnect(); null }
            else {
                val body = InputStreamReader(c.inputStream).readText().also { c.disconnect() }
                val root = JSONObject(body)
                val obj  = if (root.has("active")) root else (root.optJSONObject("session") ?: root)
                if (!obj.optBoolean("active", false)) null
                else {
                    val s = fetchSensor(ctx)
                    IncubationData(
                        dayNumber   = if (obj.has("elapsed_days")) obj.optInt("elapsed_days") else null,
                        totalDays   = if (obj.has("total_days"))   obj.optInt("total_days")   else null,
                        species     = obj.optString("species").takeIf { it.isNotBlank() } ?: "TerraBreed",
                        temperature = s?.temperature, humidity = s?.humidity
                    )
                }
            }
        } catch (_: Exception) { null }
    }
}
`; }

// ── Kotlin Providers ──────────────────────────────────────────────────────────
function ktSensor(pkg) { return `package ${pkg}
import android.appwidget.AppWidgetManager; import android.appwidget.AppWidgetProvider
import android.content.Context; import android.widget.RemoteViews
class TbSensorWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val p = goAsync(); val v = RemoteViews(ctx.packageName, R.layout.tb_widget_sensor)
            Thread { try {
                val d = TbWidgetApi.fetchSensor(ctx)
                v.setTextViewText(R.id.tb_temp_value,  d?.temperature?.let { "%.1f\u00B0C".format(it) } ?: "--\u00B0C")
                v.setTextViewText(R.id.tb_humid_value, d?.humidity?.let    { "%.0f%%".format(it) }       ?: "--%  ")
                v.setTextViewText(R.id.tb_chart_temp_label,  d?.temperature?.let { "%.1f".format(it) } ?: "--")
                v.setTextViewText(R.id.tb_chart_humid_label, d?.humidity?.let    { "%.0f".format(it) } ?: "--")
                // Suhu range 20-42C, Humid 0-100%, max=1000
                val tp = d?.temperature?.let { ((it - 20.0) / 22.0 * 1000).toInt().coerceIn(0, 1000) } ?: 500
                val hp = d?.humidity?.let    { (it * 10).toInt().coerceIn(0, 1000) }                   ?: 600
                v.setProgressBar(R.id.tb_chart_temp,  1000, tp, false)
                v.setProgressBar(R.id.tb_chart_humid, 1000, hp, false)
                mgr.updateAppWidget(id, v)
            } finally { p.finish() } }.start()
        }
    }
}`; }

function ktIncub(pkg) { return `package ${pkg}
import android.appwidget.AppWidgetManager; import android.appwidget.AppWidgetProvider
import android.content.Context; import android.widget.RemoteViews
class TbIncubWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val p = goAsync(); val v = RemoteViews(ctx.packageName, R.layout.tb_widget_incubation)
            Thread { try {
                val d = TbWidgetApi.fetchIncubation(ctx)
                if (d != null && d.dayNumber != null) {
                    v.setTextViewText(R.id.tb_incub_day,     "Hari %d/%d".format(d.dayNumber, d.totalDays ?: 21))
                    v.setTextViewText(R.id.tb_incub_species, (d.species ?: "TerraBreed").replaceFirstChar { it.uppercase() })
                    v.setTextViewText(R.id.tb_incub_sensor,
                        (d.temperature?.let { "%.1f\u00B0C".format(it) } ?: "--\u00B0C") +
                        "  " + (d.humidity?.let { "%.0f%%".format(it) } ?: "--%"))
                } else {
                    v.setTextViewText(R.id.tb_incub_day,     "Tidak ada sesi")
                    v.setTextViewText(R.id.tb_incub_species, "TerraBreed")
                    v.setTextViewText(R.id.tb_incub_sensor,  "")
                }
                mgr.updateAppWidget(id, v)
            } finally { p.finish() } }.start()
        }
    }
}`; }

// FIX KRITIS: CLEAR_TOP + NEW_TASK agar deep-link diproses ulang
// meski Activity sudah berjalan. SINGLE_TOP sebelumnya membuat Android
// skip onNewIntent jika Activity sudah ada di atas back-stack.
function ktAi(pkg) { return `package ${pkg}
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class TbAiWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        for (id in ids) {
            val v = RemoteViews(ctx.packageName, R.layout.tb_widget_ai)

            // Tap teks input → buka halaman AI Chat
            val chatIntent = Intent(Intent.ACTION_VIEW, Uri.parse("mobile:///ai")).apply {
                setPackage(ctx.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            v.setOnClickPendingIntent(R.id.tb_ai_input,
                PendingIntent.getActivity(ctx, 2001, chatIntent, flags))

            // Tap mic → buka halaman AI Voice Call (auto-start)
            val voiceIntent = Intent(Intent.ACTION_VIEW, Uri.parse("mobile:///ai?voice=1")).apply {
                setPackage(ctx.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            v.setOnClickPendingIntent(R.id.tb_ai_mic,
                PendingIntent.getActivity(ctx, 2002, voiceIntent, flags))

            mgr.updateAppWidget(id, v)
        }
    }
}`; }

// ── Manifest helper ───────────────────────────────────────────────────────────
function addReceiver(app, name, infoRes) {
  if (!app.receiver) app.receiver = [];
  if (app.receiver.some(r => r.$?.['android:name'] === name)) return;
  app.receiver.push({
    $: { 'android:name': name, 'android:exported': 'true' },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
    'meta-data':     [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/${infoRes}` } }],
  });
}

// ── Main plugin ───────────────────────────────────────────────────────────────
const withAndroidNativeWidget = (config, options = {}) => {
  const serverUrl = options.serverUrl || 'https://kendo-assistant.com/terrabreed';

  config = withDangerousMod(config, ['android', async (cfg) => {
    const root   = cfg.modRequest.platformProjectRoot;
    const pkg    = cfg.android?.package || 'com.example.app';
    const pkgDir = pkg.replace(/\./g, '/');
    const res    = path.join(root, 'app/src/main/res');
    const src    = path.join(root, 'app/src/main/java', pkgDir);

    // Drawables
    writeFile(path.join(res, 'drawable', 'tb_widget_bg.xml'),    TB_WIDGET_BG);
    writeFile(path.join(res, 'drawable', 'tb_ai_input_bg.xml'),  TB_AI_INPUT_BG);
    writeFile(path.join(res, 'drawable', 'tb_mic_btn_bg.xml'),   TB_MIC_BTN_BG);
    writeFile(path.join(res, 'drawable', 'tb_chart_temp.xml'),   TB_CHART_TEMP);
    writeFile(path.join(res, 'drawable', 'tb_chart_humid.xml'),  TB_CHART_HUMID);

    // Layouts
    writeFile(path.join(res, 'layout', 'tb_widget_sensor.xml'),     layoutSensor());
    writeFile(path.join(res, 'layout', 'tb_widget_incubation.xml'), layoutIncubation());
    writeFile(path.join(res, 'layout', 'tb_widget_ai.xml'),         layoutAi());

    // AppWidget info
    writeFile(path.join(res, 'xml', 'tb_info_sensor.xml'),     widgetInfoHV('tb_widget_sensor',     220, 110, 4, 2));
    writeFile(path.join(res, 'xml', 'tb_info_incubation.xml'), widgetInfoHV('tb_widget_incubation', 250,  80, 5, 2));
    writeFile(path.join(res, 'xml', 'tb_info_ai.xml'),         widgetInfoH ('tb_widget_ai',         250,  62, 5, 1));

    // Kotlin
    writeFile(path.join(src, 'TbWidgetApi.kt'),             ktApi(pkg, serverUrl));
    writeFile(path.join(src, 'TbSensorWidgetProvider.kt'),  ktSensor(pkg));
    writeFile(path.join(src, 'TbIncubWidgetProvider.kt'),   ktIncub(pkg));
    writeFile(path.join(src, 'TbAiWidgetProvider.kt'),      ktAi(pkg));

    return cfg;
  }]);

  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    const pkg = cfg.android?.package || 'com.example.app';
    addReceiver(app, pkg + '.TbSensorWidgetProvider',  'tb_info_sensor');
    addReceiver(app, pkg + '.TbIncubWidgetProvider',   'tb_info_incubation');
    addReceiver(app, pkg + '.TbAiWidgetProvider',      'tb_info_ai');
    return cfg;
  });

  return config;
};

module.exports = withAndroidNativeWidget;
