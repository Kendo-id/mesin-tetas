import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useIncubator } from "@/context/IncubatorContext";
import { GaugeCircle } from "@/components/GaugeCircle";
import { SensorCard } from "@/components/SensorCard";
import { AlertBanner } from "@/components/AlertBanner";

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    sensor, status, incubation,
    isConnected, isLoading, lastUpdated, lastError,
    refreshNow,
  } = useIncubator();
  const [refreshing, setRefreshing] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    refreshNow();
    setTimeout(() => setRefreshing(false), 1200);
  }, [refreshNow]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const formatTime = (d: Date | null) => {
    if (!d) return "--";
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const fmtNum = (v: number, dec = 1) =>
    isConnected && v !== 0 ? v.toFixed(dec) : "--";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient
        colors={[colors.card, colors.background]}
        style={[styles.header, { paddingTop: topPad + 12 }]}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>TerraBreed</Text>
            <View style={styles.connRow}>
              <View style={[styles.connDot, {
                backgroundColor: isConnected ? colors.accent : isLoading ? colors.warning : colors.destructive,
              }]} />
              <Text style={[styles.connLabel, { color: colors.mutedForeground }]}>
                {isLoading && !isConnected
                  ? "Menghubungkan..."
                  : isConnected
                  ? `Update ${formatTime(lastUpdated)}`
                  : "Tidak terhubung"}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.push("/history")}
            style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="bar-chart-2" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isConnected && incubation.active && (
          <View style={[styles.incubationBadge, {
            backgroundColor: colors.primary + "22",
            borderColor: colors.primary + "44",
          }]}>
            <Feather name="clock" size={13} color={colors.primary} />
            <Text style={[styles.incubationText, { color: colors.primary }]}>
              {incubation.species?.charAt(0).toUpperCase()}{incubation.species?.slice(1)}
              {" · "}Hari ke-{incubation.elapsed_days}/{incubation.total_days}
              {" · "}{incubation.total_eggs} telur
            </Text>
          </View>
        )}
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {!isConnected && !isLoading && (
          <AlertBanner
            message={
              lastError
                ? lastError
                : "Gagal terhubung ke server. Buka Pengaturan untuk atur URL server."
            }
            type="error"
          />
        )}

        {isLoading && !isConnected && (
          <AlertBanner message="Menghubungkan ke server..." type="info" />
        )}

        {/* Main Gauges */}
        <View style={styles.gaugesRow}>
          <GaugeCircle
            value={isConnected ? sensor.temp : 0}
            min={30}
            max={45}
            target={sensor.target_temp}
            unit="°C"
            label="Suhu Aktif"
            color={colors.temperatureColor}
            size={160}
            placeholder={!isConnected}
          />
          <GaugeCircle
            value={isConnected ? sensor.humidity : 0}
            min={20}
            max={100}
            target={sensor.target_humid}
            unit="%"
            label="Kelembaban"
            color={colors.humidityColor}
            size={160}
            placeholder={!isConnected}
          />
        </View>

        {/* Target Bar */}
        <View style={[styles.targetBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.targetItem}>
            <Feather name="target" size={14} color={colors.mutedForeground} />
            <Text style={[styles.targetLabel, { color: colors.mutedForeground }]}>Target Suhu</Text>
            <Text style={[styles.targetValue, { color: colors.temperatureColor }]}>
              {isConnected ? `${sensor.target_temp}°C` : "--"}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.targetItem}>
            <Feather name="droplet" size={14} color={colors.mutedForeground} />
            <Text style={[styles.targetLabel, { color: colors.mutedForeground }]}>Target Lembab</Text>
            <Text style={[styles.targetValue, { color: colors.humidityColor }]}>
              {isConnected ? `${sensor.target_humid}%` : "--"}
            </Text>
          </View>
        </View>

        {/* Sensor cards + device status — hanya tampil ketika terhubung */}
        {isConnected ? (
          <>
            <View style={styles.cardRow}>
              <SensorCard
                icon="thermometer"
                label="DS18B20 #1"
                value={fmtNum(sensor.temp_ds1)}
                unit="°C"
                color={colors.temperatureColor}
                status={Math.abs(sensor.temp_ds1 - sensor.target_temp) <= 1 ? "ok" : "warn"}
              />
              <SensorCard
                icon="thermometer"
                label="DS18B20 #2"
                value={fmtNum(sensor.temp_ds2)}
                unit="°C"
                color={colors.temperatureColor}
                status={Math.abs(sensor.temp_ds2 - sensor.target_temp) <= 1 ? "ok" : "warn"}
              />
            </View>

            <View style={styles.cardRow}>
              <SensorCard
                icon="wind"
                label="SHT31"
                value={fmtNum(sensor.temp_sht)}
                unit="°C"
                color={colors.fanColor}
                status="ok"
              />
              <SensorCard
                icon="layers"
                label="Posisi Rak"
                value={status.tray_position || (status.tray_tilted ? "Kiri" : "Kanan")}
                unit=""
                color={colors.accent}
                subtitle={`Motor: ${status.motor_state}`}
              />
            </View>

            {/* Device Status */}
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>STATUS PERANGKAT</Text>
            <View style={styles.deviceGrid}>
              {[
                { label: "Pemanas", icon: "zap" as const, active: status.heater, color: colors.heaterColor },
                { label: "Humidifier", icon: "droplet" as const, active: status.humidifier, color: colors.humidityColor },
                { label: "Kipas", icon: "wind" as const, active: status.fan, color: colors.fanColor },
                { label: "Mode Auto", icon: "cpu" as const, active: status.auto_mode, color: colors.primary },
              ].map((item) => (
                <View key={item.label} style={[styles.deviceChip, {
                  backgroundColor: item.active ? item.color + "18" : colors.card,
                  borderColor: item.active ? item.color + "66" : colors.border,
                }]}>
                  <Feather name={item.icon} size={14} color={item.active ? item.color : colors.mutedForeground} />
                  <Text style={[styles.deviceChipLabel, { color: item.active ? item.color : colors.mutedForeground }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.deviceChipStatus, { color: item.active ? item.color : colors.mutedForeground }]}>
                    {item.active ? "ON" : "OFF"}
                  </Text>
                </View>
              ))}
            </View>

            {/* Interval Info */}
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.infoRow}>
                <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Interval Balik</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{status.turn_interval_min} menit</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Feather name="clock" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Durasi Motor</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{status.turn_duration_sec} detik</Text>
              </View>
            </View>
          </>
        ) : (
          /* Placeholder ketika tidak terhubung */
          <View style={[styles.offlinePlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
            <Text style={[styles.offlineTitle, { color: colors.foreground }]}>Belum Terhubung</Text>
            <Text style={[styles.offlineDesc, { color: colors.mutedForeground }]}>
              Buka tab Pengaturan dan masukkan URL server Flask Anda, lalu tekan "Test & Simpan".
            </Text>
            <Pressable
              onPress={() => router.push("/(tabs)/settings")}
              style={[styles.offlineBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="settings" size={16} color="#fff" />
              <Text style={styles.offlineBtnText}>Buka Pengaturan</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  connRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  incubationBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  incubationText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scroll: { padding: 16, gap: 12 },
  gaugesRow: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingVertical: 8 },
  targetBar: { flexDirection: "row", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  targetItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, padding: 12 },
  targetLabel: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  targetValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  divider: { width: 1 },
  cardRow: { flexDirection: "row", gap: 10 },
  sectionTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1, marginTop: 4 },
  deviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  deviceChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  deviceChipLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  deviceChipStatus: { fontSize: 11, fontFamily: "Inter_700Bold" },
  infoCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  infoLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  offlinePlaceholder: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center", gap: 12, marginTop: 8 },
  offlineTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  offlineDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  offlineBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  offlineBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
