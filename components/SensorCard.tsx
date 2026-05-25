import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface SensorCardProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  unit: string;
  color: string;
  subtitle?: string;
  status?: "ok" | "warn" | "error";
}

export function SensorCard({
  icon,
  label,
  value,
  unit,
  color,
  subtitle,
  status = "ok",
}: SensorCardProps) {
  const colors = useColors();

  const statusColor =
    status === "ok"
      ? colors.accent
      : status === "warn"
        ? colors.warning
        : colors.destructive;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: color + "22" }]}>
        <Feather name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
        <Text style={[styles.unit, { color: colors.mutedForeground }]}>{unit}</Text>
      </View>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: statusColor }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    flex: 1,
    borderWidth: 1,
    gap: 6,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
