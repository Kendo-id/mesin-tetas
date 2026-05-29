/**
   * withAndroidNativeWidget.js
   * Custom Expo Config Plugin: generate native Android AppWidget (Kotlin + XML).
   */
  const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
  const fs   = require('fs');
  const path = require('path');

  function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
  function writeFile(p, c) { ensureDir(path.dirname(p)); fs.writeFileSync(p, c, 'utf8'); }

  // ── Background drawable: semi-transparan 70% + sudut halus 16dp ──────────────

  function makeWidgetBg() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <shape xmlns:android="http://schemas.android.com/apk/res/android"
      android:shape="rectangle">
      <solid android:color="#B30F172A"/>
      <corners android:radius="16dp"/>
  </shape>`;
  }

  // ── Layout XMLs ───────────────────────────────────────────────────────────────

  function makeTemperatureLayout() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:orientation="vertical"
      android:background="@drawable/tb_widget_bg"
      android:paddingStart="18dp"
      android:paddingEnd="18dp"
      android:paddingTop="14dp"
      android:paddingBottom="14dp"
      android:gravity="center_vertical">
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="SUHU"
          android:textColor="#64748B"
          android:textSize="10sp"
          android:letterSpacing="0.08"/>
      <TextView
          android:id="@+id/tb_temp_value"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="--\u00B0C"
          android:textColor="#F59E0B"
          android:textSize="38sp"
          android:textStyle="bold"/>
      <TextView
          android:id="@+id/tb_humid_sub"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="Lembab: --%"
          android:textColor="#94A3B8"
          android:textSize="11sp"/>
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="TerraBreed"
          android:textColor="#334155"
          android:textSize="9sp"
          android:layout_marginTop="2dp"/>
  </LinearLayout>`;
  }

  function makeHumidityLayout() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:orientation="vertical"
      android:background="@drawable/tb_widget_bg"
      android:paddingStart="18dp"
      android:paddingEnd="18dp"
      android:paddingTop="14dp"
      android:paddingBottom="14dp"
      android:gravity="center_vertical">
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="KELEMBAPAN"
          android:textColor="#64748B"
          android:textSize="10sp"
          android:letterSpacing="0.08"/>
      <TextView
          android:id="@+id/tb_humid_value"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="--%"
          android:textColor="#38BDF8"
          android:textSize="38sp"
          android:textStyle="bold"/>
      <TextView
          android:id="@+id/tb_temp_sub"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="Suhu: --\u00B0C"
          android:textColor="#94A3B8"
          android:textSize="11sp"/>
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="TerraBreed"
          android:textColor="#334155"
          android:textSize="9sp"
          android:layout_marginTop="2dp"/>
  </LinearLayout>`;
  }

  function makeIncubationLayout() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:orientation="vertical"
      android:background="@drawable/tb_widget_bg"
      android:paddingStart="18dp"
      android:paddingEnd="18dp"
      android:paddingTop="14dp"
      android:paddingBottom="14dp"
      android:gravity="center_vertical">
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="INKUBASI"
          android:textColor="#64748B"
          android:textSize="10sp"
          android:letterSpacing="0.08"/>
      <TextView
          android:id="@+id/tb_incub_day"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="Tidak ada sesi"
          android:textColor="#22C55E"
          android:textSize="22sp"
          android:textStyle="bold"/>
      <TextView
          android:id="@+id/tb_incub_species"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="TerraBreed"
          android:textColor="#E2E8F0"
          android:textSize="12sp"/>
      <TextView
          android:id="@+id/tb_incub_sensor"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text=""
          android:textColor="#64748B"
          android:textSize="10sp"
          android:layout_marginTop="2dp"/>
  </LinearLayout>`;
  }

  // ── AppWidget Info XMLs ───────────────────────────────────────────────────────

  function makeWidgetInfo(layoutName, minWidth, minHeight, cellW, cellH) {
    return `<?xml version="1.0" encoding="utf-8"?>
  <appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
      android:minWidth="${minWidth}dp"
      android:minHeight="${minHeight}dp"
      android:targetCellWidth="${cellW}"
      android:targetCellHeight="${cellH}"
      android:updatePeriodMillis="1800000"
      android:initialLayout="@layout/${layoutName}"
      android:resizeMode="horizontal|vertical"
      android:widgetCategory="home_screen"/>`;
  }

  // ── Kotlin Helper ─────────────────────────────────────────────────────────────

  function makeKotlinHelper(pkg, serverUrl) {
    return `package ${pkg}

  import android.content.Context
  import org.json.JSONObject
  import java.io.InputStreamReader
  import java.net.HttpURLConnection
  import java.net.URL

  object TbWidgetApi {
      private const val DEFAULT_URL = "${serverUrl}"
      private const val PREFS_NAME  = "TerraBreedWidget"
      private const val KEY_URL     = "server_url"

      fun getServerUrl(ctx: Context): String {
          val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          return prefs.getString(KEY_URL, DEFAULT_URL) ?: DEFAULT_URL
      }

      fun setServerUrl(ctx: Context, url: String) {
          ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
              .edit().putString(KEY_URL, url.trimEnd('/')).apply()
      }

      data class SensorData(val temperature: Double?, val humidity: Double?)
      data class IncubationData(
          val dayNumber: Int?, val totalDays: Int?,
          val species: String?, val temperature: Double?, val humidity: Double?
      )

      private fun JSONObject.getTemp(): Double? {
          for (k in listOf("temp", "temperature", "suhu")) {
              if (has(k)) { val v = optDouble(k); if (!v.isNaN()) return v }
          }
          return null
      }

      private fun JSONObject.getHumid(): Double? {
          for (k in listOf("humidity", "lembab", "humid")) {
              if (has(k)) { val v = optDouble(k); if (!v.isNaN()) return v }
          }
          return null
      }

      fun fetchSensor(ctx: Context): SensorData? = try {
          val conn = URL(getServerUrl(ctx).trimEnd('/') + "/api/sensor/latest")
              .openConnection() as HttpURLConnection
          conn.connectTimeout = 8000
          conn.readTimeout    = 8000
          conn.requestMethod  = "GET"
          conn.setRequestProperty("Accept", "application/json")
          if (conn.responseCode != 200) { conn.disconnect(); return null }
          val body = InputStreamReader(conn.inputStream).readText()
          conn.disconnect()
          val root = JSONObject(body)
          val obj  = root.optJSONObject("sensor") ?: root.optJSONObject("data") ?: root
          SensorData(obj.getTemp(), obj.getHumid())
      } catch (e: Exception) { null }

      fun fetchIncubation(ctx: Context): IncubationData? = try {
          val conn = URL(getServerUrl(ctx).trimEnd('/') + "/api/incubation/current")
              .openConnection() as HttpURLConnection
          conn.connectTimeout = 8000
          conn.readTimeout    = 8000
          conn.requestMethod  = "GET"
          conn.setRequestProperty("Accept", "application/json")
          if (conn.responseCode != 200) { conn.disconnect(); return null }
          val body    = InputStreamReader(conn.inputStream).readText()
          conn.disconnect()
          val root    = JSONObject(body)
          val session = root.optJSONObject("session") ?: return null
          val sensor  = fetchSensor(ctx)
          IncubationData(
              dayNumber   = session.optInt("day_number").takeIf { session.has("day_number") },
              totalDays   = session.optInt("total_days").takeIf { session.has("total_days") },
              species     = session.optString("species", "TerraBreed"),
              temperature = sensor?.temperature,
              humidity    = sensor?.humidity
          )
      } catch (e: Exception) { null }
  }
  `;
  }

  // ── Kotlin Providers (goAsync dipanggil di onUpdate, bukan companion object) ──

  function makeTempProvider(pkg) {
    return `package ${pkg}

  import android.appwidget.AppWidgetManager
  import android.appwidget.AppWidgetProvider
  import android.content.Context
  import android.widget.RemoteViews

  class TbTempWidgetProvider : AppWidgetProvider() {
      override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
          for (id in ids) {
              val pending = goAsync()
              val views   = RemoteViews(ctx.packageName, R.layout.tb_widget_temperature)
              Thread {
                  try {
                      val data = TbWidgetApi.fetchSensor(ctx)
                      views.setTextViewText(R.id.tb_temp_value,
                          data?.temperature?.let { "%.1f\u00B0C".format(it) } ?: "--\u00B0C")
                      views.setTextViewText(R.id.tb_humid_sub,
                          data?.humidity?.let { "Lembab: %.0f%%".format(it) } ?: "Lembab: --%")
                      mgr.updateAppWidget(id, views)
                  } finally {
                      pending.finish()
                  }
              }.start()
          }
      }
  }
  `;
  }

  function makeHumidProvider(pkg) {
    return `package ${pkg}

  import android.appwidget.AppWidgetManager
  import android.appwidget.AppWidgetProvider
  import android.content.Context
  import android.widget.RemoteViews

  class TbHumidWidgetProvider : AppWidgetProvider() {
      override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
          for (id in ids) {
              val pending = goAsync()
              val views   = RemoteViews(ctx.packageName, R.layout.tb_widget_humidity)
              Thread {
                  try {
                      val data = TbWidgetApi.fetchSensor(ctx)
                      views.setTextViewText(R.id.tb_humid_value,
                          data?.humidity?.let { "%.0f%%".format(it) } ?: "--%")
                      views.setTextViewText(R.id.tb_temp_sub,
                          data?.temperature?.let { "Suhu: %.1f\u00B0C".format(it) } ?: "Suhu: --\u00B0C")
                      mgr.updateAppWidget(id, views)
                  } finally {
                      pending.finish()
                  }
              }.start()
          }
      }
  }
  `;
  }

  function makeIncubProvider(pkg) {
    return `package ${pkg}

  import android.appwidget.AppWidgetManager
  import android.appwidget.AppWidgetProvider
  import android.content.Context
  import android.widget.RemoteViews

  class TbIncubWidgetProvider : AppWidgetProvider() {
      override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
          for (id in ids) {
              val pending = goAsync()
              val views   = RemoteViews(ctx.packageName, R.layout.tb_widget_incubation)
              Thread {
                  try {
                      val data = TbWidgetApi.fetchIncubation(ctx)
                      if (data?.dayNumber != null) {
                          views.setTextViewText(R.id.tb_incub_day,
                              "Hari %d/%d".format(data.dayNumber, data.totalDays ?: 21))
                          views.setTextViewText(R.id.tb_incub_species,
                              (data.species ?: "TerraBreed").replaceFirstChar { it.uppercase() })
                          views.setTextViewText(R.id.tb_incub_sensor,
                              (data.temperature?.let { "%.1f\u00B0C".format(it) } ?: "--\u00B0C") +
                              "  " +
                              (data.humidity?.let { "%.0f%%".format(it) } ?: "--%"))
                      } else {
                          views.setTextViewText(R.id.tb_incub_day, "Tidak ada sesi")
                          views.setTextViewText(R.id.tb_incub_species, "TerraBreed")
                          views.setTextViewText(R.id.tb_incub_sensor, "")
                      }
                      mgr.updateAppWidget(id, views)
                  } finally {
                      pending.finish()
                  }
              }.start()
          }
      }
  }
  `;
  }

  // ── Manifest helpers ──────────────────────────────────────────────────────────

  function addReceiver(app, name, infoRes) {
    if (!app.receiver) app.receiver = [];
    if (app.receiver.some(r => r.$?.['android:name'] === name)) return;
    app.receiver.push({
      $: { 'android:name': name, 'android:exported': 'true' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/${infoRes}` } }],
    });
  }

  // ── Main plugin ───────────────────────────────────────────────────────────────

  const withAndroidNativeWidget = (config, options = {}) => {
    const serverUrl = options.serverUrl || 'https://kendo-assistant.com/terrabreed';

    config = withDangerousMod(config, ['android', async (cfg) => {
      const root   = cfg.modRequest.platformProjectRoot;
      const pkg    = cfg.android?.package || 'com.example.app';
      const pkgDir = pkg.replace(/\./g, '/');
      const resDir = path.join(root, 'app', 'src', 'main', 'res');
      const srcDir = path.join(root, 'app', 'src', 'main', 'java', pkgDir);

      writeFile(path.join(resDir, 'drawable', 'tb_widget_bg.xml'), makeWidgetBg());
      writeFile(path.join(resDir, 'layout', 'tb_widget_temperature.xml'), makeTemperatureLayout());
      writeFile(path.join(resDir, 'layout', 'tb_widget_humidity.xml'),    makeHumidityLayout());
      writeFile(path.join(resDir, 'layout', 'tb_widget_incubation.xml'),  makeIncubationLayout());
      writeFile(path.join(resDir, 'xml', 'tb_info_temperature.xml'), makeWidgetInfo('tb_widget_temperature', 180, 110, 4, 2));
      writeFile(path.join(resDir, 'xml', 'tb_info_humidity.xml'),    makeWidgetInfo('tb_widget_humidity', 180, 110, 4, 2));
      writeFile(path.join(resDir, 'xml', 'tb_info_incubation.xml'),  makeWidgetInfo('tb_widget_incubation', 250, 80, 5, 2));
      writeFile(path.join(srcDir, 'TbWidgetApi.kt'),           makeKotlinHelper(pkg, serverUrl));
      writeFile(path.join(srcDir, 'TbTempWidgetProvider.kt'),  makeTempProvider(pkg));
      writeFile(path.join(srcDir, 'TbHumidWidgetProvider.kt'), makeHumidProvider(pkg));
      writeFile(path.join(srcDir, 'TbIncubWidgetProvider.kt'), makeIncubProvider(pkg));
      return cfg;
    }]);

    config = withAndroidManifest(config, (cfg) => {
      const app = cfg.modResults.manifest.application[0];
      const pkg = cfg.android?.package || 'com.example.app';
      addReceiver(app, pkg + '.TbTempWidgetProvider',  'tb_info_temperature');
      addReceiver(app, pkg + '.TbHumidWidgetProvider', 'tb_info_humidity');
      addReceiver(app, pkg + '.TbIncubWidgetProvider', 'tb_info_incubation');
      return cfg;
    });

    return config;
  };

  module.exports = withAndroidNativeWidget;
  