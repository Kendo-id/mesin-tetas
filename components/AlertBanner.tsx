import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface AlertBannerProps {
  message: string;
  type?: "error" | "warning" | "info";
  onDismiss?: () => void;
}

export function AlertBanner({ message, type = "warning", onDismiss }: AlertBannerProps) {
  const colors = useColors();

  const bgColor =
    type === "error" ? colors.destructive + "22" :
    type === "warning" ? colors.warning + "22" :
    colors.secondary + "22";

  const borderColor =
    type === "error" ? colors.destructive :
    type === "warning" ? colors.warning :
    colors.secondary;

  const iconName: keyof typeof Feather.glyphMap =
    type === "error" ? "alert-circle" : type === "warning" ? "alert-triangle" : "info";

  return (
    <View style={[styles.banner, { backgroundColor: bgColor, borderColor }]}>
      <Feather name={iconName} size={16} color={borderColor} />
      <Text style={[styles.message, { color: colors.foreground }]} numberOfLines={2}>
        {message}
      </Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
