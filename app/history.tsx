import React, { useEffect, useMemo, useState } from "react";
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
import { buildApi } from "@/constants/api";
import { useIncubator } from "@/context/IncubatorContext";

interface HistoryRow {
  ts: number;
  temp: number;
  temp_ds1: number;
  humidity: number;
  target_temp: number;
  target_humid: number;
}

interface AlarmRow {
  id: number;
  ts: number;
  type: string;
  message: string;
  value?: number;
}

interface DailyFeedback {
  day: string;
  total_rated: number;
  thumbs_up: number;
  thumbs_down: number;
  positive_pct: number | null;
}

interface SessionFeedback {
  session_id: number;
  species: string;
  started_at: number;
  ended_at: number | null;
  total_eggs: number | null;
  total_rated: number;
  thumbs_up: number;
  thumbs_down: number;
  positive_pct: number | null;
}

interface FeedbackAnalytics {
  period_days: number;
  overall: {
    total_rated: number;
    thumbs_up: number;
    thumbs_down: number;
    positive_pct: number | null;
  };
  daily: DailyFeedback[];
  per_session: SessionFeedback[];
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
  colors,
}: {
  data: HistoryRow[];
  valueKey: keyof HistoryRow;
  targetKey?: keyof HistoryRow;
  color: string;
  min: number;
  max: number;
  unit: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
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
      {yLabels.map((v) => (
        <SvgText key={v} x={PAD.left - 4} y={normalize(v) + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">
          {v}{unit}
        </SvgText>
      ))}
      <Path d={area} fill={color + "22"} />
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
      <Circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={4}
        fill={color}
      />
    </Svg>
  );
}

function formatAlarmTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("id-ID", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function alarmTypeColor(type: string, colors: ReturnType<typeof import("@/hooks/useColors").useColors>) {
  if (type?.includes("high") || type?.includes("over") || type?.includes("TINGGI")) return colors.destructive;
  if (type?.includes("low") || type?.includes("RENDAH")) return colors.warning;
  return colors.secondary;
}

function FeedbackBar({ pct, colors }: { pct: number | null; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const safeP = pct ?? 0;
  const barColor = safeP >= 70 ? colors.accent : safeP >= 40 ? colors.warning : colors.destructive;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
      <View style={[fbStyles.track, { backgroundColor: colors.muted }]}>
        <View style={[fbStyles.fill, { width: `${safeP}%` as any, backgroundColor: barColor }]} />
      </View>
      <Text style={[fbStyles.pctLabel, { color: barColor }]}>
        {pct !== null ? `${pct.toFixed(0)}%` : "--"}
      </Text>
    </View>
  );
}

const fbStyles = StyleSheet.create({
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  pctLabel: { fontSize: 12, fontFamily: "Inter_700Bold", minWidth: 38, textAlign: "right" },
});

export default function HistoryScreen() {
  const colors = useColors();
  const { serverUrl } = useIncubator();
  const API = useMemo(() => buildApi(serverUrl), [serverUrl]);
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [alarms, setAlarms] = useState<AlarmRow[]>([]);
  const [period, setPeriod] = useState(60);
  const [loading, setLoading] = useState(true);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState<"daily" | "session">("daily");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [histRes, statsRes, alarmsRes] = await Promise.all([
          fetch(API.sensorHistory(period)),
          fetch(API.sensorStats),
          fetch(API.alarms(20)),
        ]);
        const [h, s, a] = await Promise.all([
          histRes.json(),
          statsRes.json(),
          alarmsRes.json(),
        ]);
        setHistory(Array.isArray(h) ? h : []);
        setStats(s || {});
        setAlarms(Array.isArray(a) ? a : []);
      } catch {}
      setLoading(false);
    };
    load();
  }, [period, API]);

  useEffect(() => {
    const loadAnalytics = async () => {
      setAnalyticsLoading(true);
      try {
        const res = await fetch(API.chatFeedbackAnalytics(analyticsDays));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data: FeedbackAnalytics = await res.json();
        setAnalytics(data);
      } catch {
        setAnalytics(null);
      }
      setAnalyticsLoading(false);
    };
    loadAnalytics();
  }, [analyticsDays, API]);

  const fmt = (v?: number) => (v !== undefined && v !== null ? Number(v).toFixed(1) : "--");

  const fmtSessionDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" });
  };

  const overallPct = analytics?.overall?.positive_pct ?? null;
  const overallColor = overallPct === null
    ? colors.mutedForeground
    : overallPct >= 70 ? colors.accent
    : overallPct >= 40 ? colors.warning
    : colors.destructive;

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
            <MiniChart
              data={history}
              valueKey="temp"
              targetKey="target_temp"
              color={colors.temperatureColor}
              min={34}
              max={42}
              unit="°"
              colors={colors}
            />
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
            <MiniChart
              data={history}
              valueKey="humidity"
              targetKey="target_humid"
              color={colors.humidityColor}
              min={30}
              max={90}
              unit="%"
              colors={colors}
            />
          ) : (
            <View style={styles.chartPlaceholder}>
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Belum ada data</Text>
            </View>
          )}
        </View>

        <Text style={[styles.dataPoints, { color: colors.mutedForeground }]}>
          {history.length} data point · 24 jam terakhir: {stats.data_points || 0} log
        </Text>

        {/* ══════════════════════════════
            FEEDBACK ANALYTICS TERRA AI
        ══════════════════════════════ */}
        <View style={styles.alarmHeader}>
          <Feather name="bar-chart-2" size={15} color={colors.primary} />
          <Text style={[styles.alarmTitle, { color: colors.foreground }]}>Feedback Respons TERRA</Text>
        </View>

        {/* Period selector analytics */}
        <View style={[styles.analyticsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Header dengan period chips */}
          <View style={styles.analyticsPeriodRow}>
            {[3, 7, 14, 30].map((d) => (
              <Pressable
                key={d}
                onPress={() => setAnalyticsDays(d)}
                style={[styles.analyticsPeriodChip, {
                  backgroundColor: analyticsDays === d ? colors.primary + "22" : "transparent",
                  borderColor: analyticsDays === d ? colors.primary : colors.border,
                }]}
              >
                <Text style={[styles.analyticsPeriodText, { color: analyticsDays === d ? colors.primary : colors.mutedForeground }]}>
                  {d}h
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Overall stat */}
          {analyticsLoading ? (
            <View style={styles.analyticsLoadingWrap}>
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Memuat analitik...</Text>
            </View>
          ) : analytics && analytics.overall.total_rated > 0 ? (
            <>
              {/* Summary row */}
              <View style={[styles.overallRow, { borderColor: colors.border }]}>
                <View style={styles.overallStat}>
                  <Text style={[styles.overallBigNum, { color: overallColor }]}>
                    {overallPct !== null ? `${overallPct.toFixed(0)}%` : "--"}
                  </Text>
                  <Text style={[styles.overallLabel, { color: colors.mutedForeground }]}>Positif</Text>
                </View>
                <View style={[styles.overallDivider, { backgroundColor: colors.border }]} />
                <View style={styles.overallStat}>
                  <Text style={[styles.overallBigNum, { color: colors.accent }]}>
                    {analytics.overall.thumbs_up}
                  </Text>
                  <View style={styles.overallIconRow}>
                    <Feather name="thumbs-up" size={11} color={colors.accent} />
                    <Text style={[styles.overallLabel, { color: colors.mutedForeground }]}>Positif</Text>
                  </View>
                </View>
                <View style={[styles.overallDivider, { backgroundColor: colors.border }]} />
                <View style={styles.overallStat}>
                  <Text style={[styles.overallBigNum, { color: colors.destructive }]}>
                    {analytics.overall.thumbs_down}
                  </Text>
                  <View style={styles.overallIconRow}>
                    <Feather name="thumbs-down" size={11} color={colors.destructive} />
                    <Text style={[styles.overallLabel, { color: colors.mutedForeground }]}>Negatif</Text>
                  </View>
                </View>
                <View style={[styles.overallDivider, { backgroundColor: colors.border }]} />
                <View style={styles.overallStat}>
                  <Text style={[styles.overallBigNum, { color: colors.foreground }]}>
                    {analytics.overall.total_rated}
                  </Text>
                  <Text style={[styles.overallLabel, { color: colors.mutedForeground }]}>Total</Text>
                </View>
              </View>

              {/* Tab harian vs per sesi */}
              <View style={[styles.tabRow, { borderColor: colors.border }]}>
                <Pressable
                  onPress={() => setAnalyticsTab("daily")}
                  style={[styles.tabBtn, analyticsTab === "daily" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                >
                  <Text style={[styles.tabBtnText, { color: analyticsTab === "daily" ? colors.primary : colors.mutedForeground }]}>
                    Per Hari
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setAnalyticsTab("session")}
                  style={[styles.tabBtn, analyticsTab === "session" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                >
                  <Text style={[styles.tabBtnText, { color: analyticsTab === "session" ? colors.primary : colors.mutedForeground }]}>
                    Per Sesi
                  </Text>
                </Pressable>
              </View>

              {/* Per-day view */}
              {analyticsTab === "daily" && (
                <View style={styles.analyticsRows}>
                  {analytics.daily.length === 0 ? (
                    <Text style={[styles.noDataText, { color: colors.mutedForeground }]}>
                      Belum ada feedback dalam periode ini.
                    </Text>
                  ) : analytics.daily.map((row) => (
                    <View key={row.day} style={styles.analyticsRow}>
                      <Text style={[styles.analyticsRowDay, { color: colors.foreground }]}>{row.day}</Text>
                      <FeedbackBar pct={row.positive_pct} colors={colors} />
                      <View style={styles.analyticsRowVotes}>
                        <Feather name="thumbs-up" size={11} color={colors.accent} />
                        <Text style={[styles.analyticsVoteNum, { color: colors.accent }]}>{row.thumbs_up}</Text>
                        <Feather name="thumbs-down" size={11} color={colors.destructive} />
                        <Text style={[styles.analyticsVoteNum, { color: colors.destructive }]}>{row.thumbs_down}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Per-session view */}
              {analyticsTab === "session" && (
                <View style={styles.analyticsRows}>
                  {analytics.per_session.length === 0 ? (
                    <Text style={[styles.noDataText, { color: colors.mutedForeground }]}>
                      Belum ada sesi inkubasi dengan feedback.
                    </Text>
                  ) : analytics.per_session.map((s) => (
                    <View key={s.session_id} style={[styles.sessionRow, { borderColor: colors.border }]}>
                      <View style={styles.sessionRowTop}>
                        <View style={[styles.sessionBadge, { backgroundColor: colors.primary + "18" }]}>
                          <Text style={[styles.sessionBadgeText, { color: colors.primary }]}>
                            #{s.session_id}
                          </Text>
                        </View>
                        <Text style={[styles.sessionSpecies, { color: colors.foreground }]}>
                          {s.species?.charAt(0).toUpperCase()}{s.species?.slice(1)}
                          {s.total_eggs ? ` · ${s.total_eggs} telur` : ""}
                        </Text>
                        <Text style={[styles.sessionDate, { color: colors.mutedForeground }]}>
                          {fmtSessionDate(s.started_at)}
                          {s.ended_at ? ` – ${fmtSessionDate(s.ended_at)}` : " (aktif)"}
                        </Text>
                      </View>
                      {s.total_rated > 0 ? (
                        <View style={styles.sessionRowBottom}>
                          <FeedbackBar pct={s.positive_pct} colors={colors} />
                          <View style={styles.analyticsRowVotes}>
                            <Feather name="thumbs-up" size={11} color={colors.accent} />
                            <Text style={[styles.analyticsVoteNum, { color: colors.accent }]}>{s.thumbs_up}</Text>
                            <Feather name="thumbs-down" size={11} color={colors.destructive} />
                            <Text style={[styles.analyticsVoteNum, { color: colors.destructive }]}>{s.thumbs_down}</Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={[styles.noDataText, { color: colors.mutedForeground }]}>
                          Belum ada feedback untuk sesi ini.
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={styles.analyticsEmpty}>
              <Feather name="message-circle" size={28} color={colors.mutedForeground} />
              <Text style={[styles.analyticsEmptyTitle, { color: colors.foreground }]}>
                Belum ada feedback
              </Text>
              <Text style={[styles.analyticsEmptyDesc, { color: colors.mutedForeground }]}>
                Gunakan tombol thumbs-up/down di chat TERRA untuk menilai respons AI.
              </Text>
            </View>
          )}
        </View>

        {/* Alarm History */}
        <View style={styles.alarmHeader}>
          <Feather name="bell" size={15} color={colors.warning} />
          <Text style={[styles.alarmTitle, { color: colors.foreground }]}>Riwayat Alarm</Text>
          <View style={[styles.alarmBadge, { backgroundColor: colors.warning + "22" }]}>
            <Text style={[styles.alarmBadgeText, { color: colors.warning }]}>{alarms.length}</Text>
          </View>
        </View>

        {alarms.length === 0 ? (
          <View style={[styles.alarmEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="check-circle" size={24} color={colors.accent} />
            <Text style={[styles.alarmEmptyText, { color: colors.mutedForeground }]}>
              Tidak ada alarm dalam periode ini
            </Text>
          </View>
        ) : (
          alarms.map((alarm) => (
            <View
              key={alarm.id}
              style={[styles.alarmRow, {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderLeftColor: alarmTypeColor(alarm.type, colors),
              }]}
            >
              <View style={[styles.alarmDot, { backgroundColor: alarmTypeColor(alarm.type, colors) }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.alarmMessage, { color: colors.foreground }]} numberOfLines={2}>
                  {alarm.message}
                </Text>
                <Text style={[styles.alarmTime, { color: colors.mutedForeground }]}>
                  {formatAlarmTime(alarm.ts)}
                  {alarm.value !== undefined ? ` · ${alarm.value.toFixed(1)}` : ""}
                </Text>
              </View>
            </View>
          ))
        )}
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
  alarmHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  alarmTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  alarmBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  alarmBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  alarmEmpty: { borderRadius: 14, borderWidth: 1, padding: 20, alignItems: "center", gap: 8 },
  alarmEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  alarmRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  alarmDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  alarmMessage: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  alarmTime: { fontSize: 11, fontFamily: "Inter_400Regular" },

  // ── Feedback Analytics ──
  analyticsCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  analyticsPeriodRow: { flexDirection: "row", gap: 6 },
  analyticsPeriodChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  analyticsPeriodText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  analyticsLoadingWrap: { paddingVertical: 24, alignItems: "center" },
  overallRow: { flexDirection: "row", borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  overallStat: { flex: 1, alignItems: "center", padding: 12, gap: 3 },
  overallDivider: { width: 1 },
  overallBigNum: { fontSize: 20, fontFamily: "Inter_700Bold" },
  overallLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  overallIconRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, marginHorizontal: -14 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  analyticsRows: { gap: 8 },
  analyticsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  analyticsRowDay: { fontSize: 12, fontFamily: "Inter_500Medium", minWidth: 72 },
  analyticsRowVotes: { flexDirection: "row", alignItems: "center", gap: 3, minWidth: 60 },
  analyticsVoteNum: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginRight: 4 },
  noDataText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 8 },
  sessionRow: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  sessionRowTop: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  sessionBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  sessionBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  sessionSpecies: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  sessionDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sessionRowBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  analyticsEmpty: { paddingVertical: 24, alignItems: "center", gap: 8 },
  analyticsEmptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  analyticsEmptyDesc: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
});
