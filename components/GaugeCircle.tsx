import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface GaugeCircleProps {
  value: number;
  min: number;
  max: number;
  target: number;
  unit: string;
  label: string;
  color: string;
  size?: number;
}

export function GaugeCircle({
  value,
  min,
  max,
  target,
  unit,
  label,
  color,
  size = 160,
}: GaugeCircleProps) {
  const colors = useColors();
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const dashOffset = circumference * (1 - pct * 0.75);
  const startAngle = 135;
  const cx = size / 2;
  const cy = size / 2;

  const isOk = Math.abs(value - target) <= (max - min) * 0.05;
  const statusColor = isOk ? colors.accent : colors.warning;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`grad-${label}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={color} stopOpacity="1" />
            <Stop offset="100%" stopColor={color} stopOpacity="0.6" />
          </LinearGradient>
        </Defs>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={colors.muted}
          strokeWidth={10}
          fill="none"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          rotation={startAngle}
          origin={`${cx},${cy}`}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={`url(#grad-${label})`}
          strokeWidth={10}
          fill="none"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={startAngle}
          origin={`${cx},${cy}`}
        />
      </Svg>
      <View style={styles.content}>
        <Text style={[styles.value, { color }]}>
          {typeof value === "number" ? value.toFixed(1) : value}
        </Text>
        <Text style={[styles.unit, { color: colors.mutedForeground }]}>{unit}</Text>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
  },
  value: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: -2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 4,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
});
