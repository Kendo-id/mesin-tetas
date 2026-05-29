/**
   * withAndroidNativeWidget.js
   * Custom Expo Config Plugin: generate native Android AppWidget (Kotlin + XML).
   * Tidak bergantung pada react-native-android-widget atau JS bridge sama sekali.
   */
  const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
  const fs   = require('fs');
  const path = require('path');

  function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
  function writeFile(p, c) { ensureDir(path.dirname(p)); fs.writeFileSync(p, c, 'utf8'); }

  // ── Layout XMLs ─────────────────────────────────────────────────────────────

  function makeTemperatureLayout() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:orientation="vertical"
      android:background="#0F172A"
      android:paddingStart="14dp"
      android:paddingEnd="14dp"
      android:gravity="center_vertical">
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="SUHU"
          android:textColor="#64748B"
          android:textSize="10sp"/>
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
          android:textSize="10sp"/>
  </LinearLayout>`;
  }

  function makeHumidityLayout() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:orientation="vertical"
      android:background="#0F172A"
      android:paddingStart="14dp"
      android:paddingEnd="14dp"
      android:gravity="center_vertical">
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="KELEMBAPAN"
          android:textColor="#64748B"
          android:textSize="10sp"/>
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
          android:textSize="10sp"/>
  </LinearLayout>`;
  }

  function makeIncubationLayout() {
    return `<?xml version="1.0" encoding="utf-8"?>
  <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:orientation="vertical"
      android:background="#0F172A"
      android:paddingStart="14dp"
      android:paddingEnd="14dp"
      android:gravity="center_vertical">
      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="INKUBASI"
          android:textColor="#64748B"
          android:textSize="10sp"/>
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
          android:text="--\u00B0C  --%"
          android:textColor="#64748B"
          android:textSize="10sp"/>
  </LinearLayout>`;
  }

  // ── AppWidget Info XMLs (android:description dihapus — wajib @string/ ref) ──

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

  // ── Kotlin Helper ────────────────────────────────────────────────────────────

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

      data class SensorData(val temperature: Double?, val humidity: Double?)
      data class IncubationData(
          val dayNumber: Int?, val totalDays: Int?,
          val species: String?, val temperature: Double?, val humidity: Double?
      )

      fun fetchSensor(ctx: Context): SensorData? = try {
          val conn = URL(getServerUrl(ctx).trimEnd('/') + "/api/sensor/latest")
              .openConnection() as HttpURLConnection
          conn.connectTimeout = 5000; conn.readTimeout = 5000
          val body = InputStreamReader(conn.inputStream).readText()
          conn.disconnect()
          val sensor = JSONObject(body).optJSONObject("sensor") ?: return null
          val temp  = if (sensor.has("temperature")) sensor.optDouble("temperature")
                      else sensor.optDouble("temp")
          val humid = sensor.optDouble("humidity")
          SensorData(if (temp.isNaN()) null else temp, if (humid.isNaN()) null else humid)
      } catch (e: Exception) { null }

      fun fetchIncubation(ctx: Context): IncubationData? = try {
          val conn = URL(getServerUrl(ctx).trimEnd('/') + "/api/incubation/current")
              .openConnection() as HttpURLConnection
          conn.connectTimeout = 5000; conn.readTimeout = 5000
          val body = InputStreamReader(conn.inputStream).readText()
          conn.disconnect()
          val session = JSONObject(body).optJSONObject("session") ?: return null
          val sensor  = fetchSensor(ctx)
          IncubationData(
              dayNumber   = if (session.has("day_number")) session.optInt("day_number") else null,
              totalDays   = if (session.has("total_days")) session.optInt("total_days") else null,
              species     = session.optString("species", "TerraBreed"),
              temperature = sensor?.temperature,
              humidity    = sensor?.humidity
          )
      } catch (e: Exception) { null }
  }
  `;
  }

  function makeTempProvider(pkg) {
    return `package ${pkg}

  import android.appwidget.AppWidgetManager
  import android.appwidget.AppWidgetProvider
  import android.content.Context
  import android.widget.RemoteViews

  class TbTempWidgetProvider : AppWidgetProvider() {
      override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
          for (id in ids) update(ctx, mgr, id)
      }
      companion object {
          fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
              val views = RemoteViews(ctx.packageName, R.layout.tb_widget_temperature)
              Thread {
                  val data = TbWidgetApi.fetchSensor(ctx)
                  views.setTextViewText(R.id.tb_temp_value,
                      data?.temperature?.let { "%.1f\u00B0C".format(it) } ?: "--\u00B0C")
                  views.setTextViewText(R.id.tb_humid_sub,
                      data?.humidity?.let { "Lembab: %.0f%%".format(it) } ?: "Lembab: --%")
                  mgr.updateAppWidget(id, views)
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
          for (id in ids) update(ctx, mgr, id)
      }
      companion object {
          fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
              val views = RemoteViews(ctx.packageName, R.layout.tb_widget_humidity)
              Thread {
                  val data = TbWidgetApi.fetchSensor(ctx)
                  views.setTextViewText(R.id.tb_humid_value,
                      data?.humidity?.let { "%.0f%%".format(it) } ?: "--%")
                  views.setTextViewText(R.id.tb_temp_sub,
                      data?.temperature?.let { "Suhu: %.1f\u00B0C".format(it) } ?: "Suhu: --\u00B0C")
                  mgr.updateAppWidget(id, views)
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
          for (id in ids) update(ctx, mgr, id)
      }
      companion object {
          fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
              val views = RemoteViews(ctx.packageName, R.layout.tb_widget_incubation)
              Thread {
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
              }.start()
          }
      }
  }
  `;
  }

  // ── Manifest helpers ─────────────────────────────────────────────────────────

  function addReceiver(app, name, infoRes) {
    if (!app.receiver) app.receiver = [];
    if (app.receiver.some(r => r.$?.['android:name'] === name)) return;
    app.receiver.push({
      $: { 'android:name': name, 'android:exported': 'true' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/${infoRes}` } }],
    });
  }

  // ── Main plugin ──────────────────────────────────────────────────────────────

  const withAndroidNativeWidget = (config, options = {}) => {
    const serverUrl = options.serverUrl || 'https://kendo-assistant.com/terrabreed';

    config = withDangerousMod(config, ['android', async (cfg) => {
      const root   = cfg.modRequest.platformProjectRoot;
      const pkg    = cfg.android?.package || 'com.example.app';
      const pkgDir = pkg.replace(/\./g, '/');
      const resDir = path.join(root, 'app', 'src', 'main', 'res');
      const srcDir = path.join(root, 'app', 'src', 'main', 'java', pkgDir);

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
  