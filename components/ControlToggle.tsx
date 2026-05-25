import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

interface ControlToggleProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sublabel?: string;
  active: boolean;
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function ControlToggle({
  icon,
  label,
  sublabel,
  active,
  color,
  loading = false,
  disabled = false,
  onToggle,
}: ControlToggleProps) {
  const colors = useColors();
  const activeColor = color || colors.primary;

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onToggle();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: active ? activeColor + "18" : colors.card,
          borderColor: active ? activeColor : colors.border,
          opacity: pressed ? 0.85 : disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: active ? activeColor + "22" : colors.muted }]}>
        {loading ? (
          <ActivityIndicator size="small" color={activeColor} />
        ) : (
          <Feather name={icon} size={22} color={active ? activeColor : colors.mutedForeground} />
        )}
      </View>
      <Text style={[styles.label, { color: active ? colors.foreground : colors.mutedForeground }]}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={[styles.sublabel, { color: colors.mutedForeground }]}>{sublabel}</Text>
      ) : null}
      <View style={[styles.statusDot, { backgroundColor: active ? activeColor : colors.muted }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    flex: 1,
    borderWidth: 1.5,
    alignItems: "flex-start",
    gap: 8,
    minHeight: 110,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  sublabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "absolute",
    top: 12,
    right: 12,
  },
});
