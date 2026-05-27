import React, { useRef, useState, useEffect } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";

import { useColors } from "@/hooks/useColors";
import { useIncubator } from "@/context/IncubatorContext";
import { buildApi } from "@/constants/api";
import type { TestResult } from "@/context/IncubatorContext";
import { scanLocalNetwork, ScanResult, ScanProgress } from "@/utils/networkScan";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type SpeciesKey = "ayam" | "bebek" | "kalkun" | "puyuh" | "angsa" | "custom";

const SPECIES_PRESETS: Record<SpeciesKey, { temp: number; humid: number; days: number; label: string }> = {
  ayam:   { temp: 37.5, humid: 60, days: 21, label: "Ayam Kampung" },
  bebek:  { temp: 37.8, humid: 65, days: 28, label: "Bebek" },
  kalkun: { temp: 37.5, humid: 60, days: 28, label: "Kalkun" },
  puyuh:  { temp: 37.5, humid: 60, days: 17, label: "Puyuh" },
  angsa:  { temp: 37.6, humid: 65, days: 30, label: "Angsa" },
  custom: { temp: 37.5, humid: 60, days: 21, label: "Custom" },
};

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    sensor, status, incubation,
    isConnected, lastError, serverUrl, serverConfig,
    sendCommand, refreshNow, updateServerUrl, testConnection,
  } = useIncubator();

  const API = buildApi(serverUrl);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── Pengaturan ESP32 ──
  const [targetTemp, setTargetTemp] = useState(String(sensor.target_temp));
  const [targetHumid, setTargetHumid] = useState(String(sensor.target_humid));
  const [turnInterval, setTurnInterval] = useState(String(status.turn_interval_min));
  const [turnDuration, setTurnDuration] = useState(String(status.turn_duration_sec));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    setTargetTemp(String(sensor.target_temp));
    setTargetHumid(String(sensor.target_humid));
    setTurnInterval(String(status.turn_interval_min));
    setTurnDuration(String(status.turn_duration_sec));
  }, [sensor.target_temp, sensor.target_humid, status.turn_interval_min, status.turn_duration_sec, isConnected]);

  // ── Koneksi Server ──
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => { setServerUrlInput(serverUrl); }, [serverUrl]);

  const handleTestAndSave = async () => {
    const url = serverUrlInput.trim();
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await testConnection(url);
    setTestResult(result);
    setTesting(false);
    if (result.ok) {
      setSavingUrl(true);
      await updateServerUrl(url).catch(() => {
        Alert.alert("Error", "Gagal menyimpan URL server.");
      });
      setSavingUrl(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleSaveOnly = async () => {
    const url = serverUrlInput.trim();
    if (!url) return;
    setSavingUrl(true);
    await updateServerUrl(url);
    setSavingUrl(false);
    setTestResult(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Disimpan", "URL server disimpan. Menghubungkan...");
  };

  // ── Scan Jaringan Lokal ──
  const [scanPort, setScanPort] = useState("80");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const cancelRef = useRef({ current: false });

  const startScan = async () => {
    setScanning(true);
    setScanResults([]);
    setScanError(null);
    setScanProgress(null);
    cancelRef.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const port = parseInt(scanPort) || 80;
      const results = await scanLocalNetwork(
        port,
        (p) => setScanProgress({ ...p }),
        cancelRef
      );
      setScanResults(results);
      if (results.length === 0 && !cancelRef.current) {
        setScanError(`Tidak ditemukan server di port ${port}. Coba port lain atau pastikan Flask sudah jalan.`);
      }
      if (results.length > 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan gagal.");
    } finally {
      setScanning(false);
    }
  };

  const cancelScan = () => {
    cancelRef.current = true;
    setScanning(false);
  };

  const selectScanResult = async (result: ScanResult) => {
    setServerUrlInput(result.url);
    setTestResult(null);
    setScanResults([]);
    setScanProgress(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Langsung simpan & hubungkan
    setSavingUrl(true);
    await updateServerUrl(result.url).catch(() => {});
    setSavingUrl(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const progressPct = scanProgress
    ? Math.round((scanProgress.scanned / scanProgress.total) * 100)
    : 0;

  // ── Inkubasi ──
  const [species, setSpecies] = useState<SpeciesKey>("ayam");
  const [totalEggs, setTotalEggs] = useState("100");
  const [sessionNotes, setSessionNotes] = useState("");
  const [startingSession, setStartingSession] = useState(false);
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [hatchedInput, setHatchedInput] = useState("0");

  const saveSettings = async () => {
    if (!isConnected) {
      Alert.alert("Tidak Terhubung", "Hubungkan ke server terlebih dahulu.");
      return;
    }
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(API.settings, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_temp:   parseFloat(targetTemp),
          target_humid:  parseFloat(targetHumid),
          turn_interval: parseInt(turnInterval),
          turn_duration: parseInt(turnDuration),
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      refreshNow();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Berhasil", "Pengaturan disimpan dan dikirim ke ESP32.");
    } catch {
      Alert.alert("Error", "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  };

  const startIncubation = async () => {
    if (!isConnected) {
      Alert.alert("Tidak Terhubung", "Hubungkan ke server terlebih dahulu.");
      return;
    }
    const preset = SPECIES_PRESETS[species];
    setStartingSession(true);
    try {
      const res = await fetch(API.incubationStart, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          species,
          total_days: preset.days,
          total_eggs: parseInt(totalEggs) || 0,
          notes: sessionNotes,
          source: "mobile_app",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        refreshNow();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Sesi Dimulai", `Inkubasi ${preset.label} (${totalEggs} telur) berhasil dibuat.`);
      }
    } catch {
      Alert.alert("Error", "Gagal membuat sesi inkubasi.");
    } finally {
      setStartingSession(false);
    }
  };

  const confirmFinishIncubation = async () => {
    setFinishModalVisible(false);
    try {
      await fetch(API.incubationFinish, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: incubation.id,
          hatched: parseInt(hatchedInput) || 0,
          infertile: 0,
        }),
      });
      refreshNow();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Gagal menyelesaikan sesi inkubasi.");
    }
  };

  // ── Widget ──
  const [widgetEnabled, setWidgetEnabled] = useState(false);

  const toggleWidget = async (val: boolean) => {
    setWidgetEnabled(val);
    if (val) {
      const { status: ps } = await Notifications.requestPermissionsAsync();
      if (ps !== "granted") { setWidgetEnabled(false); return; }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "TerraBreed Monitor",
          body: isConnected
            ? `Suhu: ${sensor.temp.toFixed(1)}°C | Lembab: ${sensor.humidity.toFixed(0)}%`
            : "TerraBreed aktif",
          sticky: true,
          data: { type: "widget" },
        },
        trigger: null,
      });
    } else {
      await Notifications.dismissAllNotificationsAsync();
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const NumberInput = ({ label, value, onChangeText, unit }: {
    label: string; value: string; onChangeText: (v: string) => void; unit: string;
  }) => (
    <View style={[styles.numInput, { borderColor: colors.border, backgroundColor: colors.muted }]}>
      <Text style={[styles.numInputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.numInputRight}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          style={[styles.numInputField, { color: isConnected ? colors.foreground : colors.mutedForeground }]}
          editable={isConnected}
        />
        <Text style={[styles.numInputUnit, { color: colors.mutedForeground }]}>{unit}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Modal Selesaikan Inkubasi */}
      <Modal
        visible={finishModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFinishModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Selesaikan Inkubasi</Text>
            <Text style={[styles.modalDesc, { color: colors.mutedForeground }]}>
              Berapa telur yang berhasil menetas?
            </Text>
            <TextInput
              value={hatchedInput}
              onChangeText={setHatchedInput}
              keyboardType="numeric"
              style={[styles.modalInput, {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.muted,
              }]}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalBtns}>
              <Pressable
                onPress={() => setFinishModalVisible(false)}
                style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Batal</Text>
              </Pressable>
              <Pressable
                onPress={confirmFinishIncubation}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Selesaikan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={[styles.header, {
        paddingTop: topPad + 12,
        backgroundColor: colors.card,
        borderBottomColor: colors.border,
      }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Pengaturan</Text>
        <View style={styles.connStatus}>
          <View style={[styles.connDot, { backgroundColor: isConnected ? colors.accent : colors.destructive }]} />
          <Text style={[styles.connLabel, { color: colors.mutedForeground }]}>
            {isConnected ? "Terhubung" : "Tidak terhubung"}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
        keyboardShouldPersistTaps="handled"
      >

        {/* ══════════════════════════════════════
            KONEKSI SERVER
        ══════════════════════════════════════ */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>KONEKSI SERVER</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* URL Input */}
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>URL Server Flask</Text>
          <TextInput
            style={[styles.textInput, {
              color: colors.foreground,
              borderColor: testResult
                ? testResult.ok ? colors.accent : colors.destructive
                : colors.border,
              backgroundColor: colors.background,
            }]}
            value={serverUrlInput}
            onChangeText={(t) => { setServerUrlInput(t); setTestResult(null); }}
            placeholder="http://192.168.1.x/terrabreed"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {/* Hint */}
          <View style={[styles.hintBox, { backgroundColor: colors.primary + "12" }]}>
            <Feather name="info" size={12} color={colors.primary} />
            <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
              {"Lokal (Nginx port 80): http://192.168.1.x/terrabreed\n"}
              {"HTTPS domain:         https://kendo-assistant.com/terrabreed"}
            </Text>
          </View>

          {/* Status aktif */}
          <View style={[styles.statusRow, {
            backgroundColor: isConnected ? colors.accent + "12" : colors.destructive + "12",
            borderColor: isConnected ? colors.accent + "44" : colors.destructive + "33",
          }]}>
            <View style={[styles.statusDot, {
              backgroundColor: isConnected ? colors.accent : colors.destructive,
            }]} />
            <Text style={[styles.statusText, { color: isConnected ? colors.accent : colors.destructive }]}>
              {isConnected ? `Terhubung · ${serverUrl}` : "Tidak terhubung"}
            </Text>
          </View>

          {/* Pesan error koneksi */}
          {!isConnected && lastError && (
            <View style={[styles.errorBox, {
              backgroundColor: colors.destructive + "11",
              borderColor: colors.destructive + "44",
            }]}>
              <Feather name="alert-circle" size={13} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{lastError}</Text>
            </View>
          )}

          {/* Hasil test */}
          {testResult && (
            <View style={[styles.testResultBox, {
              backgroundColor: testResult.ok ? colors.accent + "11" : colors.destructive + "11",
              borderColor: testResult.ok ? colors.accent : colors.destructive,
            }]}>
              <Feather
                name={testResult.ok ? "check-circle" : "x-circle"}
                size={15}
                color={testResult.ok ? colors.accent : colors.destructive}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.testResultText, {
                  color: testResult.ok ? colors.accent : colors.destructive,
                }]}>
                  {testResult.message}
                </Text>
                {testResult.url && (
                  <Text style={[styles.testResultUrl, { color: colors.mutedForeground }]}>
                    {testResult.url}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Tombol Test & Simpan */}
          <View style={styles.btnRow}>
            <Pressable
              onPress={handleTestAndSave}
              disabled={testing || savingUrl || !serverUrlInput.trim()}
              style={({ pressed }) => [styles.testBtn, {
                backgroundColor: colors.primary,
                opacity: testing || savingUrl || !serverUrlInput.trim() ? 0.55 : pressed ? 0.85 : 1,
              }]}
            >
              {testing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Feather name="wifi" size={14} color="#fff" />
              }
              <Text style={styles.testBtnText}>
                {testing ? "Mengetes..." : "Test & Simpan"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSaveOnly}
              disabled={savingUrl || testing || !serverUrlInput.trim()}
              style={({ pressed }) => [styles.saveUrlBtn, {
                borderColor: colors.border,
                opacity: savingUrl || testing ? 0.55 : pressed ? 0.8 : 1,
              }]}
            >
              <Text style={[styles.saveUrlBtnText, { color: colors.foreground }]}>
                {savingUrl ? "Menyimpan..." : "Simpan Saja"}
              </Text>
            </Pressable>
          </View>

          {/* ── Divider ── */}
          <View style={[styles.scanDivider, { backgroundColor: colors.border }]} />

          {/* ── SCAN OTOMATIS ── */}
          <Text style={[styles.scanTitle, { color: colors.foreground }]}>Scan Otomatis Jaringan Lokal</Text>
          <Text style={[styles.scanDesc, { color: colors.mutedForeground }]}>
            Deteksi subnet dari IP DHCP perangkat, lalu scan semua host untuk menemukan server Flask.
          </Text>

          {/* Port input + Tombol scan */}
          <View style={styles.scanRow}>
            <View style={[styles.portInputWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Text style={[styles.portLabel, { color: colors.mutedForeground }]}>Port:</Text>
              <TextInput
                value={scanPort}
                onChangeText={setScanPort}
                keyboardType="numeric"
                style={[styles.portInput, { color: colors.foreground }]}
                editable={!scanning}
                selectTextOnFocus
              />
            </View>

            {scanning ? (
              <Pressable
                onPress={cancelScan}
                style={[styles.scanBtn, { backgroundColor: colors.destructive }]}
              >
                <Feather name="x" size={14} color="#fff" />
                <Text style={styles.scanBtnText}>Batal</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={startScan}
                style={({ pressed }) => [styles.scanBtn, {
                  backgroundColor: colors.accent,
                  opacity: pressed ? 0.8 : 1,
                }]}
              >
                <Feather name="search" size={14} color="#fff" />
                <Text style={styles.scanBtnText}>Scan</Text>
              </Pressable>
            )}
          </View>

          {/* Progress bar + status */}
          {scanning && scanProgress && (
            <View style={styles.scanProgressWrap}>
              <View style={styles.scanProgressHeader}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.scanProgressText, { color: colors.mutedForeground }]}>
                  {`Scanning ${scanProgress.subnet}x${scanPort === "80" ? "" : scanPort === "443" ? "" : `:${scanPort}`}  ·  ${scanProgress.scanned}/${scanProgress.total}`}
                </Text>
                <Text style={[styles.scanPct, { color: colors.accent }]}>{progressPct}%</Text>
              </View>
              {/* Progress bar */}
              <View style={[styles.progressBarBg, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressBarFill, {
                  backgroundColor: colors.accent,
                  width: `${progressPct}%` as any,
                }]} />
              </View>
            </View>
          )}

          {/* Live found servers saat scanning */}
          {scanning && scanProgress && scanProgress.found.length > 0 && (
            <View style={styles.scanFoundWrap}>
              <Text style={[styles.scanFoundLabel, { color: colors.mutedForeground }]}>
                Ditemukan ({scanProgress.found.length}):
              </Text>
              {scanProgress.found.map((r) => (
                <Pressable
                  key={r.ip}
                  onPress={() => selectScanResult(r)}
                  style={({ pressed }) => [styles.scanFoundItem, {
                    backgroundColor: colors.accent + "15",
                    borderColor: colors.accent,
                    opacity: pressed ? 0.8 : 1,
                  }]}
                >
                  <Feather name="server" size={14} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.scanFoundUrl, { color: colors.foreground }]}>{r.url}</Text>
                    <Text style={[styles.scanFoundLatency, { color: colors.accent }]}>{r.latencyMs}ms</Text>
                  </View>
                  <View style={[styles.usePill, { backgroundColor: colors.accent }]}>
                    <Text style={styles.usePillText}>Gunakan</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* Hasil scan selesai */}
          {!scanning && scanResults.length > 0 && (
            <View style={styles.scanFoundWrap}>
              <Text style={[styles.scanFoundLabel, { color: colors.mutedForeground }]}>
                Server TerraBreed ditemukan ({scanResults.length}):
              </Text>
              {scanResults.map((r) => (
                <Pressable
                  key={r.ip}
                  onPress={() => selectScanResult(r)}
                  style={({ pressed }) => [styles.scanFoundItem, {
                    backgroundColor: colors.accent + "15",
                    borderColor: colors.accent,
                    opacity: pressed ? 0.8 : 1,
                  }]}
                >
                  <Feather name="server" size={14} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.scanFoundUrl, { color: colors.foreground }]}>{r.url}</Text>
                    <Text style={[styles.scanFoundLatency, { color: colors.accent }]}>
                      {r.latencyMs}ms
                    </Text>
                  </View>
                  <View style={[styles.usePill, { backgroundColor: colors.accent }]}>
                    <Text style={styles.usePillText}>Gunakan ▶</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* Scan error */}
          {scanError && !scanning && (
            <View style={[styles.errorBox, {
              backgroundColor: colors.destructive + "11",
              borderColor: colors.destructive + "44",
            }]}>
              <Feather name="alert-triangle" size={13} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{scanError}</Text>
            </View>
          )}

          {/* Scan cancelled */}
          {!scanning && cancelRef.current && scanResults.length === 0 && !scanError && (
            <Text style={[styles.scanCancelText, { color: colors.mutedForeground }]}>
              Scan dibatalkan.
            </Text>
          )}
        </View>

        {/* ══════════════════════════════════════
            INFO SERVER — hanya saat terhubung, data dari /api/config
        ══════════════════════════════════════ */}
        {isConnected && serverConfig && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INFO SERVER</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.infoRow}>
                <Feather name="server" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Server</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {serverUrl.replace(/^https?:\/\//, "").split("/")[0]}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Feather name="cpu" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Device ID</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{serverConfig.device_id}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Feather name="radio" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>MQTT Broker</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {serverConfig.mqtt_host}:{serverConfig.mqtt_port}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* ══════════════════════════════════════
            WIDGET HOMESCREEN
        ══════════════════════════════════════ */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WIDGET HOMESCREEN</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoRow}>
            <View style={[styles.widgetIcon, { backgroundColor: colors.primary + "22" }]}>
              <Feather name="thermometer" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardLabel, { color: colors.foreground }]}>Notifikasi Suhu Real-time</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Tampilkan suhu & kelembaban di panel notifikasi
              </Text>
            </View>
            <Switch
              value={widgetEnabled}
              onValueChange={toggleWidget}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {widgetEnabled && isConnected && (
            <View style={[styles.widgetPreview, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="thermometer" size={14} color={colors.primary} />
              <Text style={[styles.widgetPreviewText, { color: colors.foreground }]}>
                TerraBreed  ·  {sensor.temp.toFixed(1)}°C  |  {sensor.humidity.toFixed(0)}%
              </Text>
            </View>
          )}
        </View>

        {/* ══════════════════════════════════════
            SESI INKUBASI
        ══════════════════════════════════════ */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SESI INKUBASI</Text>
        {!isConnected ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.infoRow, { gap: 10 }]}>
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Hubungkan ke server untuk mengelola sesi inkubasi.
              </Text>
            </View>
          </View>
        ) : incubation.active ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.infoRow, { gap: 10 }]}>
              <Feather name="clock" size={18} color={colors.accent} />
              <Text style={[styles.cardLabel, { color: colors.foreground }]}>Sesi Aktif</Text>
            </View>
            <Text style={[styles.sessionSpecies, { color: colors.primary }]}>
              {incubation.species?.charAt(0).toUpperCase()}{incubation.species?.slice(1)}
            </Text>
            <Text style={[styles.sessionDetail, { color: colors.mutedForeground }]}>
              {incubation.total_eggs} telur · Hari ke-{incubation.elapsed_days}/{incubation.total_days}
            </Text>
            <Pressable
              onPress={() => { setHatchedInput("0"); setFinishModalVisible(true); }}
              style={({ pressed }) => [styles.finishBtn, {
                backgroundColor: colors.destructive + "18",
                borderColor: colors.destructive,
                opacity: pressed ? 0.8 : 1,
              }]}
            >
              <Feather name="check-circle" size={16} color={colors.destructive} />
              <Text style={[styles.finishBtnText, { color: colors.destructive }]}>Selesaikan Inkubasi</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.foreground }]}>Buat Sesi Baru</Text>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Jenis Hewan</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
                {(Object.keys(SPECIES_PRESETS) as SpeciesKey[]).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setSpecies(k)}
                    style={[styles.speciesChip, {
                      backgroundColor: species === k ? colors.primary + "22" : colors.muted,
                      borderColor: species === k ? colors.primary : colors.border,
                    }]}
                  >
                    <Text style={[styles.speciesChipText, {
                      color: species === k ? colors.primary : colors.mutedForeground,
                    }]}>
                      {SPECIES_PRESETS[k].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={[styles.numInput, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <Text style={[styles.numInputLabel, { color: colors.mutedForeground }]}>Jumlah Telur</Text>
              <TextInput
                value={totalEggs}
                onChangeText={setTotalEggs}
                keyboardType="numeric"
                style={[styles.numInputField, { color: colors.foreground }]}
              />
            </View>

            <TextInput
              value={sessionNotes}
              onChangeText={setSessionNotes}
              placeholder="Catatan (opsional)..."
              placeholderTextColor={colors.mutedForeground}
              style={[styles.notesInput, { backgroundColor: colors.muted, color: colors.foreground }]}
            />

            {species !== "custom" && (
              <View style={[styles.presetInfo, { backgroundColor: colors.accent + "11" }]}>
                <Text style={[styles.presetInfoText, { color: colors.mutedForeground }]}>
                  Preset: {SPECIES_PRESETS[species].temp}°C · {SPECIES_PRESETS[species].humid}% · {SPECIES_PRESETS[species].days} hari
                </Text>
              </View>
            )}

            <Pressable
              onPress={startIncubation}
              disabled={startingSession}
              style={({ pressed }) => [styles.startBtn, {
                backgroundColor: colors.primary,
                opacity: pressed || startingSession ? 0.8 : 1,
              }]}
            >
              <Feather name="play" size={16} color="#fff" />
              <Text style={styles.startBtnText}>
                {startingSession ? "Memulai..." : "Mulai Inkubasi"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ══════════════════════════════════════
            PENGATURAN ESP32
        ══════════════════════════════════════ */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PENGATURAN ESP32</Text>
        {!isConnected ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.infoRow, { gap: 10 }]}>
              <Feather name="lock" size={16} color={colors.mutedForeground} />
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Hubungkan ke server untuk mengubah pengaturan ESP32.
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <NumberInput label="Target Suhu" value={targetTemp} onChangeText={setTargetTemp} unit="°C" />
            <NumberInput label="Target Kelembaban" value={targetHumid} onChangeText={setTargetHumid} unit="%" />
            <NumberInput label="Interval Balik" value={turnInterval} onChangeText={setTurnInterval} unit="menit" />
            <NumberInput label="Durasi Motor" value={turnDuration} onChangeText={setTurnDuration} unit="detik" />

            <Pressable
              onPress={saveSettings}
              disabled={saving}
              style={({ pressed }) => [styles.saveBtn, {
                backgroundColor: colors.primary,
                opacity: pressed || saving ? 0.8 : 1,
              }]}
            >
              <Feather name="save" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? "Menyimpan..." : "Simpan Pengaturan"}</Text>
            </Pressable>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, gap: 4 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  connStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  scroll: { padding: 16, gap: 10 },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1, marginTop: 6 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  divider: { height: 1 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  textInput: {
    borderWidth: 1.5, borderRadius: 10, padding: 11,
    fontSize: 13, fontFamily: "Inter_400Regular",
  },
  hintBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 10 },
  hintText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 17 },
  statusRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  errorBox: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  testResultBox: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    padding: 12, borderRadius: 12, borderWidth: 1.5,
  },
  testResultText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  testResultUrl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 8 },
  testBtn: {
    flex: 1, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, padding: 13, borderRadius: 12,
  },
  testBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  saveUrlBtn: {
    paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1, alignItems: "center", justifyContent: "center",
  },
  saveUrlBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  // ── Scan ──
  scanDivider: { height: 1 },
  scanTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  scanDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: -4 },
  scanRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  portInputWrap: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  portLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  portInput: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 52, textAlign: "center" },
  scanBtn: {
    flex: 1, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12,
  },
  scanBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  scanProgressWrap: { gap: 6 },
  scanProgressHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  scanProgressText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  scanPct: { fontSize: 13, fontFamily: "Inter_700Bold" },
  progressBarBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressBarFill: { height: 6, borderRadius: 3 },
  scanFoundWrap: { gap: 8 },
  scanFoundLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  scanFoundItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  scanFoundUrl: { fontSize: 13, fontFamily: "Inter_500Medium" },
  scanFoundLatency: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  usePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  usePillText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  scanCancelText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  // ── Widget ──
  widgetIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1, flex: 1 },
  widgetPreview: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  widgetPreviewText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  // ── Inkubasi ──
  sessionSpecies: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sessionDetail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  finishBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 12, borderRadius: 12, borderWidth: 1,
  },
  finishBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  speciesChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  speciesChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  numInput: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  numInputLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  numInputRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  numInputField: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 50, textAlign: "right" },
  numInputUnit: { fontSize: 12, fontFamily: "Inter_400Regular" },
  notesInput: { borderRadius: 12, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  presetInfo: { padding: 10, borderRadius: 10 },
  presetInfoText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  startBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 14, borderRadius: 12,
  },
  startBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 14, borderRadius: 12, marginTop: 4,
  },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  // ── Modal ──
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  modalBox: { width: "100%", maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: 24, gap: 16 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  modalDesc: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalInput: {
    borderRadius: 10, borderWidth: 1, padding: 12,
    fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center",
  },
  modalBtns: { flexDirection: "row", gap: 10 },
  modalBtn: { flex: 1, padding: 13, borderRadius: 12, alignItems: "center" },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
