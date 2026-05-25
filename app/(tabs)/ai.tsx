import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { API } from "@/constants/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

type VoiceState = "idle" | "recording" | "processing" | "playing";

export default function AIScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [isCallMode, setIsCallMode] = useState(false);
  const [callTranscript, setCallTranscript] = useState("");
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    // Animate pulse when recording
    if (voiceState === "recording") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.timing(waveAnim, { toValue: 1, duration: 1200, useNativeDriver: false })
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      waveAnim.stopAnimation();
      waveAnim.setValue(0);
    }
  }, [voiceState]);

  const addMessage = useCallback((role: "user" | "assistant", content: string) => {
    const msg: Message = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      role,
      content,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return msg;
  }, []);

  const playTTS = async (text: string) => {
    try {
      setVoiceState("playing");
      const res = await fetch(API.tts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "id-ID-GadisNeural" }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const uri = URL.createObjectURL(blob);
      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setVoiceState("idle");
        }
      });
    } catch {
      setVoiceState("idle");
    }
  };

  const sendText = async (text: string) => {
    if (!text.trim()) return;
    addMessage("user", text);
    setInputText("");
    try {
      const res = await fetch(API.chat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply || "Tidak ada respons.";
      addMessage("assistant", reply);
      if (isCallMode) {
        await playTTS(reply);
      }
    } catch {
      addMessage("assistant", "Maaf, gagal terhubung ke TERRA.");
    }
  };

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        addMessage("assistant", "Izin mikrofon diperlukan untuk fitur suara.");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setVoiceState("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setVoiceState("idle");
    }
  };

  const stopRecordingAndSend = async () => {
    if (!recordingRef.current) return;
    setVoiceState("processing");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (!uri) throw new Error("No recording URI");

      const formData = new FormData();
      formData.append("audio", { uri, name: "recording.m4a", type: "audio/m4a" } as unknown as Blob);
      formData.append("lang", "id");

      const sttRes = await fetch(API.stt, { method: "POST", body: formData });
      const sttData = await sttRes.json();
      const transcript = sttData.text || "";
      setCallTranscript(transcript);
      if (transcript) {
        await sendText(transcript);
      } else {
        setVoiceState("idle");
      }
    } catch {
      setVoiceState("idle");
    }
  };

  const toggleCall = () => {
    setIsCallMode((v) => {
      if (!v) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        addMessage("assistant", "Halo! Saya TERRA, asisten inkubator Anda. Tekan dan tahan tombol mikrofon untuk berbicara dengan saya.");
      }
      return !v;
    });
  };

  const voiceButtonAction = () => {
    if (voiceState === "recording") {
      stopRecordingAndSend();
    } else if (voiceState === "idle") {
      startRecording();
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
            <Text style={styles.avatarText}>T</Text>
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>TERRA</Text>
            <Text style={[styles.headerSub, { color: colors.accent }]}>AI Asisten Inkubator</Text>
          </View>
        </View>
        <Pressable
          onPress={toggleCall}
          style={[styles.callToggle, {
            backgroundColor: isCallMode ? colors.accent + "22" : colors.card,
            borderColor: isCallMode ? colors.accent : colors.border,
          }]}
        >
          <Feather name={isCallMode ? "phone-off" : "phone"} size={18} color={isCallMode ? colors.accent : colors.mutedForeground} />
          <Text style={[styles.callToggleText, { color: isCallMode ? colors.accent : colors.mutedForeground }]}>
            {isCallMode ? "Akhiri" : "Voice Call"}
          </Text>
        </Pressable>
      </View>

      {/* Call Mode Overlay */}
      {isCallMode && (
        <LinearGradient
          colors={[colors.card, colors.background]}
          style={styles.callBanner}
        >
          <View style={[styles.callAvatarLarge, {
            backgroundColor: voiceState === "recording" ? colors.destructive + "22" :
              voiceState === "processing" ? colors.warning + "22" :
              voiceState === "playing" ? colors.accent + "22" : colors.primary + "22",
            borderColor: voiceState === "recording" ? colors.destructive :
              voiceState === "processing" ? colors.warning :
              voiceState === "playing" ? colors.accent : colors.primary,
          }]}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Text style={styles.callAvatarText}>T</Text>
            </Animated.View>
          </View>
          <Text style={[styles.callStatus, { color: colors.foreground }]}>
            {voiceState === "recording" ? "Mendengarkan..." :
             voiceState === "processing" ? "Memproses..." :
             voiceState === "playing" ? "TERRA berbicara..." : "TERRA siap"}
          </Text>
          {callTranscript ? (
            <Text style={[styles.callTranscript, { color: colors.mutedForeground }]} numberOfLines={2}>
              "{callTranscript}"
            </Text>
          ) : null}
          {/* Voice button */}
          <Pressable
            onPress={voiceButtonAction}
            disabled={voiceState === "processing" || voiceState === "playing"}
            style={({ pressed }) => [
              styles.voiceBtn,
              {
                backgroundColor: voiceState === "recording" ? colors.destructive : colors.primary,
                opacity: (voiceState === "processing" || voiceState === "playing") ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather
              name={voiceState === "recording" ? "square" : "mic"}
              size={28}
              color="#fff"
            />
          </Pressable>
          <Text style={[styles.voiceHint, { color: colors.mutedForeground }]}>
            {voiceState === "recording" ? "Tap untuk berhenti" : "Tap untuk bicara"}
          </Text>
        </LinearGradient>
      )}

      {/* Chat Messages */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.chatList, { paddingBottom: insets.bottom + 100 }]}
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primary + "22" }]}>
              <Feather name="message-circle" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Tanya TERRA</Text>
            <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
              Tanya kondisi mesin, minta kontrol perangkat, atau buat sesi inkubasi baru.
            </Text>
            {[
              "Suhu mesin sekarang berapa?",
              "Nyalakan heater",
              "Buat sesi inkubasi ayam 100 telur",
            ].map((s) => (
              <Pressable
                key={s}
                onPress={() => sendText(s)}
                style={({ pressed }) => [styles.suggestion, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.8 : 1,
                }]}
              >
                <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
                <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        )}
        {messages.map((msg) => (
          <View key={msg.id} style={[
            styles.bubble,
            msg.role === "user"
              ? [styles.bubbleUser, { backgroundColor: colors.primary }]
              : [styles.bubbleAssistant, { backgroundColor: colors.card, borderColor: colors.border }],
          ]}>
            {msg.role === "assistant" && (
              <Text style={[styles.bubbleName, { color: colors.primary }]}>TERRA</Text>
            )}
            <Text style={[
              styles.bubbleText,
              { color: msg.role === "user" ? "#fff" : colors.foreground },
            ]}>
              {msg.content}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Text Input */}
      {!isCallMode && (
        <View style={[styles.inputBar, {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 16),
        }]}>
          <Pressable
            onPress={voiceButtonAction}
            disabled={voiceState === "processing"}
            style={[styles.micBtn, {
              backgroundColor: voiceState === "recording" ? colors.destructive + "22" : colors.muted,
              borderColor: voiceState === "recording" ? colors.destructive : colors.border,
            }]}
          >
            <Feather
              name={voiceState === "recording" ? "square" : "mic"}
              size={20}
              color={voiceState === "recording" ? colors.destructive : colors.mutedForeground}
            />
          </Pressable>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ketik pesan..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.textInput, { backgroundColor: colors.muted, color: colors.foreground }]}
            onSubmitEditing={() => sendText(inputText)}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={() => sendText(inputText)}
            disabled={!inputText.trim()}
            style={({ pressed }) => [styles.sendBtn, {
              backgroundColor: inputText.trim() ? colors.primary : colors.muted,
              opacity: pressed ? 0.8 : 1,
            }]}
          >
            <Feather name="send" size={18} color={inputText.trim() ? "#fff" : colors.mutedForeground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FF6B35" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 11, fontFamily: "Inter_500Medium" },
  callToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  callToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  callBanner: { alignItems: "center", padding: 20, gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  callAvatarLarge: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  callAvatarText: { fontSize: 40, fontFamily: "Inter_700Bold", color: "#FF6B35" },
  callStatus: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  callTranscript: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center" },
  voiceBtn: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginTop: 4 },
  voiceHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  chatList: { padding: 16, gap: 10 },
  emptyState: { alignItems: "center", gap: 12, paddingTop: 20 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 20 },
  suggestion: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 12, borderWidth: 1, alignSelf: "stretch" },
  suggestionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  bubble: { borderRadius: 16, padding: 14, maxWidth: "85%", gap: 4 },
  bubbleUser: { alignSelf: "flex-end" },
  bubbleAssistant: { alignSelf: "flex-start", borderWidth: 1 },
  bubbleName: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  micBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  textInput: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
