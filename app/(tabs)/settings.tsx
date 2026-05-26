import React, { useState, useEffect } from "react";
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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";

import { useColors } from "@/hooks/useColors";
import { useIncubator } from "@/context/IncubatorContext";
import { buildApi } from "@/constants/api";

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
  const { sensor, status, incubation, sendCommand, refreshNow, serverUrl, updateServerUrl } = useIncubator();
  const API = buildApi(serverUrl);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [targetTemp, setTargetTemp] = useState(String(sensor.target_temp));
  const [targetHumid, setTargetHumid] = useState(String(sensor.target_humid));
  const [turnInterval, setTurnInterval] = useState(String(status.turn_interval_min));
  const [turnDuration, setTurnDuration] = useState(String(status.turn_duration_sec));
  const [widgetEnabled, setWidgetEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  // Modal selesai inkubasi (cross-platform pengganti Alert.prompt)
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [hatchedInput, setHatchedInput] = useState("0");

  useEffect(() => {
    setServerUrlInput(serverUrl);
  }, [serverUrl]);

  const saveServerUrl = async () => {
    if (!serverUrlInput.trim()) return;
    setSavingUrl(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateServerUrl(serverUrlInput.trim());
      Alert.alert("Berhasil", "URL server disimpan. Menghubungkan...");
    } catch {
      Alert.alert("Error", "Gagal menyimpan URL server.");
    } finally {
      setSavingUrl(false);
    }
  };

  const [species, setSpecies] = useState<SpeciesKey>("ayam");
  const [totalEggs, setTotalEggs] = useState("100");
  const [sessionNotes, setSessionNotes] = useState("");
  const [startingSession, setStartingSession] = useState(false);

  useEffect(() => {
    setTargetTemp(String(sensor.target_temp));
    setTargetHumid(String(sensor.target_humid));
    setTurnInterval(String(status.turn_interval_min));
    setTurnDuration(String(status.turn_duration_sec));
  }, [sensor.target_temp, sensor.target_humid, status.turn_interval_min, status.turn_duration_sec]);

  const saveSettings = async () => {
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(API.settings, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_temp: parseFloat(targetTemp),
          target_humid: parseFloat(targetHumid),
          turn_interval: parseInt(turnInterval),
          turn_duration: parseInt(turnDuration),
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      refreshNow();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  };

  const startIncubation = async () => {
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

  // Cross-platform: gunakan modal state, bukan Alert.prompt (iOS only)
  const finishIncubation = () => {
    if (!incubation.active) return;
    setHatchedInput("0");
    setFinishModalVisible(true);
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

  const toggleWidget = async (val: boolean) => {
    setWidgetEnabled(val);
    if (val) {
      const { status: permStatus } = await Notifications.requestPermissionsAsync();
      if (permStatus !== "granted") {
        setWidgetEnabled(false);
        Alert.alert("Izin Diperlukan", "Aktifkan notifikasi untuk widget suhu.");
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "TerraBreed Monitor",
          body: `Suhu: ${sensor.temp.toFixed(1)}°C | Lembab: ${sensor.humidity.toFixed(0)}%`,
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
    <View style={[styles.numInput, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.numInputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.numInputRight}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          style={[styles.numInputField, { color: colors.foreground }]}
        />
        <Text style={[styles.numInputUnit, { color: colors.mutedForeground }]}>{unit}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Modal Selesaikan Inkubasi — cross-platform (Android + iOS) */}
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
              style={[styles.modalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalBtns}>
              <Pressable
                onPress={() => setFinishModalVisible(false)}
                style={[styles.modalBtn, { borderColor: colors.border }]}
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

      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Pengaturan</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Widget homescreen */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WIDGET HOMESCREEN</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
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
          {widgetEnabled && (
            <View style={[styles.widgetPreview, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="thermometer" size={14} color={colors.primary} />
              <Text style={[styles.widgetPreviewText, { color: colors.foreground }]}>
                TerraBreed  ·  {sensor.temp.toFixed(1)}°C  |  {sensor.humidity.toFixed(0)}%
              </Text>
            </View>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.primary + "11" }]}>
            <Feather name="info" size={13} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Widget homescreen native tersedia setelah install dari App Store (production build).
            </Text>
          </View>
        </View>

        {/* Incubation Session */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SESI INKUBASI</Text>
        {incubation.active ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.row}>
              <Feather name="clock" size={18} color={colors.accent} />
              <Text style={[styles.cardLabel, { color: colors.foreground }]}>Sesi Aktif</Text>
            </View>
            <View style={styles.sessionInfo}>
              <Text style={[styles.sessionSpecies, { color: colors.primary }]}>
                {incubation.species?.charAt(0).toUpperCase()}{incubation.species?.slice(1)}
              </Text>
              <Text style={[styles.sessionDetail, { color: colors.mutedForeground }]}>
                {incubation.total_eggs} telur · Hari ke-{incubation.elapsed_days}/{incubation.total_days}
              </Text>
            </View>
            <Pressable
              onPress={finishIncubation}
              style={({ pressed }) => [styles.finishBtn, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive, opacity: pressed ? 0.8 : 1 }]}
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
                    <Text style={[styles.speciesChipText, { color: species === k ? colors.primary : colors.mutedForeground }]}>
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
              style={({ pressed }) => [styles.startBtn, { backgroundColor: colors.primary, opacity: pressed || startingSession ? 0.8 : 1 }]}
            >
              <Feather name="play" size={16} color="#fff" />
              <Text style={styles.startBtnText}>{startingSession ? "Memulai..." : "Mulai Inkubasi"}</Text>
            </Pressable>
          </View>
        )}

        {/* Koneksi Server */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>KONEKSI SERVER</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>URL Server</Text>
          <TextInput
            style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            value={serverUrlInput}
            onChangeText={setServerUrlInput}
            placeholder="https://192.168.1.x/terrabreed"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 10, lineHeight: 16 }}>
            Contoh IP lokal: https://192.168.1.100/terrabreed{'\n'}
            Atau: http://192.168.1.100:5000/terrabreed
          </Text>
          <Pressable
            style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center", opacity: savingUrl ? 0.6 : 1 }}
            onPress={saveServerUrl}
            disabled={savingUrl}
          >
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
              {savingUrl ? "Menyimpan..." : "Simpan & Hubungkan"}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PENGATURAN ESP32</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <NumberInput label="Target Suhu" value={targetTemp} onChangeText={setTargetTemp} unit="°C" />
          <NumberInput label="Target Kelembaban" value={targetHumid} onChangeText={setTargetHumid} unit="%" />
          <NumberInput label="Interval Balik" value={turnInterval} onChangeText={setTurnInterval} unit="menit" />
          <NumberInput label="Durasi Motor" value={turnDuration} onChangeText={setTurnDuration} unit="detik" />

          <Pressable
            onPress={saveSettings}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed || saving ? 0.8 : 1 }]}
          >
            <Feather name="save" size={16} color="#fff" />
            <Text style={styles.saveBtnText}>{saving ? "Menyimpan..." : "Simpan Pengaturan"}</Text>
          </Pressable>
        </View>

        {/* Server info */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INFO SERVER</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Feather name="server" size={14} color={colors.mutedForeground} />
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>kendo-assistant.com</Text>
          </View>
          <View style={styles.row}>
            <Feather name="cpu" size={14} color={colors.mutedForeground} />
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>ESP32 · incubator_01</Text>
          </View>
          <View style={styles.row}>
            <Feather name="radio" size={14} color={colors.mutedForeground} />
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>MQTT · 10.10.10.1:1883</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  scroll: { padding: 16, gap: 10 },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1, marginTop: 6 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  widgetIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  widgetPreview: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  widgetPreviewText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  infoBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 10 },
  infoText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  sessionInfo: { gap: 4 },
  sessionSpecies: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sessionDetail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  finishBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  finishBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    marginBottom: 8,
    fontFamily: "Inter_400Regular",
  },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  speciesChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  speciesChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  numInput: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 12, borderWidth: 1 },
  numInputLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  numInputRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  numInputField: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 50, textAlign: "right" },
  numInputUnit: { fontSize: 12, fontFamily: "Inter_400Regular" },
  notesInput: { borderRadius: 12, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  presetInfo: { padding: 10, borderRadius: 10 },
  presetInfoText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  startBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  startBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, marginTop: 4 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalBox: { width: "100%", maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: 24, gap: 16 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  modalDesc: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalInput: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalBtns: { flexDirection: "row", gap: 10 },
  modalBtn: { flex: 1, padding: 13, borderRadius: 12, alignItems: "center", borderWidth: 1 },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
