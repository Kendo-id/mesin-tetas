import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Circle, Line, Text as SvgText } from "react-native-svg";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { API } from "@/constants/api";

interface HistoryRow {
  ts: number;
  temp: number;
  temp_ds1: number;
  humidity: number;
  target_temp: number;
  target_humid: number;
}

const { width: SCREEN_W } = Dimensions.get("window");
const CHART_W = SCREEN_W - 48;
const CHART_H = 140;
const PAD = { left: 36, right: 8, top: 10, bottom: 24 };

function MiniChart({
  data,
  valueKey,
  targetKey,
  color,
  min,
  max,
  unit,
}: {
  data: HistoryRow[];
  valueKey: keyof HistoryRow;
  targetKey?: keyof HistoryRow;
  color: string;
  min: number;
  max: number;
  unit: string;
}) {
  const colors = useColors();
  if (data.length < 2) return null;

  const w = CHART_W - PAD.left - PAD.right;
  const h = CHART_H - PAD.top - PAD.bottom;

  const normalize = (v: number) => {
    const pct = Math.max(0, Math.min(1, (v - min) / (max - min)));
    return PAD.top + h * (1 - pct);
  };

  const points = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * w,
    y: normalize(Number(d[valueKey])),
  }));

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${d} L${points[points.length - 1].x},${PAD.top + h} L${PAD.left},${PAD.top + h} Z`;

  const targetVal = targetKey && data.length > 0 ? Number(data[0][targetKey]) : null;
  const targetY = targetVal !== null ? normalize(targetVal) : null;

  const yLabels = [min, (min + max) / 2, max];

  return (
    <Svg width={CHART_W} height={CHART_H}>
      {/* Grid lines */}
      {yLabels.map((v) => (
        <Line
          key={v}
          x1={PAD.left}
          x2={CHART_W - PAD.right}
          y1={normalize(v)}
          y2={normalize(v)}
          stroke={colors.border}
          strokeWidth={1}
          strokeDasharray="4,4"
        />
      ))}
      {/* Y labels */}
      {yLabels.map((v) => (
        <SvgText key={v} x={PAD.left - 4} y={normalize(v) + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">
          {v}{unit}
        </SvgText>
      ))}
      {/* Area fill */}
      <Path d={area} fill={color + "22"} />
      {/* Line */}
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Target line */}
      {targetY !== null && (
        <Line
          x1={PAD.left}
          x2={CHART_W - PAD.right}
          y1={targetY}
          y2={targetY}
          stroke={colors.warning}
          strokeWidth={1.5}
          strokeDasharray="6,4"
        />
      )}
      {/* Latest dot */}
      <Circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={4}
        fill={color}
      />
    </Svg>
  );
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState(60);
  const [loading, setLoading] = useState(true);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [histRes, statsRes] = await Promise.all([
          fetch(API.sensorHistory(period)),
          fetch(API.sensorStats),
        ]);
        const [h, s] = await Promise.all([histRes.json(), statsRes.json()]);
        setHistory(Array.isArray(h) ? h : []);
        setStats(s || {});
      } catch {}
      setLoading(false);
    };
    load();
  }, [period]);

  const fmt = (v?: number) => (v !== undefined && v !== null ? Number(v).toFixed(1) : "--");

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Riwayat Data</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        {/* Period selector */}
        <View style={styles.periodRow}>
          {[30, 60, 180, 360].map((m) => (
            <Pressable
              key={m}
              onPress={() => setPeriod(m)}
              style={[styles.periodChip, {
                backgroundColor: period === m ? colors.primary : colors.card,
                borderColor: period === m ? colors.primary : colors.border,
              }]}
            >
              <Text style={[styles.periodText, { color: period === m ? "#fff" : colors.mutedForeground }]}>
                {m < 60 ? `${m}m` : `${m / 60}j`}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: "Suhu Avg", value: fmt(stats.avg_temp), unit: "°C", color: colors.temperatureColor },
            { label: "Suhu Min", value: fmt(stats.min_temp), unit: "°C", color: colors.humidityColor },
            { label: "Suhu Max", value: fmt(stats.max_temp), unit: "°C", color: colors.heaterColor },
            { label: "Lembab Avg", value: fmt(stats.avg_humid), unit: "%", color: colors.humidityColor },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}<Text style={styles.statUnit}>{s.unit}</Text></Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Temperature Chart */}
        <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.chartHeader}>
            <Feather name="thermometer" size={16} color={colors.temperatureColor} />
            <Text style={[styles.chartTitle, { color: colors.foreground }]}>Suhu</Text>
            {history.length > 0 && (
              <Text style={[styles.chartLatest, { color: colors.temperatureColor }]}>
                {fmt(history[history.length - 1]?.temp)}°C
              </Text>
            )}
          </View>
          {loading ? (
            <View style={styles.chartPlaceholder}>
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Memuat...</Text>
            </View>
          ) : history.length > 1 ? (
            <MiniChart data={history} valueKey="temp" targetKey="target_temp" color={colors.temperatureColor} min={34} max={42} unit="°" />
          ) : (
            <View style={styles.chartPlaceholder}>
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Belum ada data</Text>
            </View>
          )}
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.temperatureColor }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Suhu aktual</Text>
            <View style={[styles.legendLine, { backgroundColor: colors.warning }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Target</Text>
          </View>
        </View>

        {/* Humidity Chart */}
        <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.chartHeader}>
            <Feather name="droplet" size={16} color={colors.humidityColor} />
            <Text style={[styles.chartTitle, { color: colors.foreground }]}>Kelembaban</Text>
            {history.length > 0 && (
              <Text style={[styles.chartLatest, { color: colors.humidityColor }]}>
                {fmt(history[history.length - 1]?.humidity)}%
              </Text>
            )}
          </View>
          {loading ? (
            <View style={styles.chartPlaceholder}>
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Memuat...</Text>
            </View>
          ) : history.length > 1 ? (
            <MiniChart data={history} valueKey="humidity" targetKey="target_humid" color={colors.humidityColor} min={30} max={90} unit="%" />
          ) : (
            <View style={styles.chartPlaceholder}>
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Belum ada data</Text>
            </View>
          )}
        </View>

        <Text style={[styles.dataPoints, { color: colors.mutedForeground }]}>
          {history.length} data point · 24 jam terakhir: {stats.data_points || 0} log
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  scroll: { padding: 16, gap: 12 },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  periodText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: { flex: 1, minWidth: "45%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statUnit: { fontSize: 13, fontFamily: "Inter_400Regular" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  chartCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  chartHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  chartTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chartLatest: { fontSize: 16, fontFamily: "Inter_700Bold" },
  chartPlaceholder: { height: CHART_H, alignItems: "center", justifyContent: "center" },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular", marginRight: 8 },
  dataPoints: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
});
