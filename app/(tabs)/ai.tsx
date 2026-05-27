import React, { useCallback, useEffect, useRef, useState } from "react";
  import {
    ActivityIndicator,
    Alert,
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
  import { useIncubator } from "@/context/IncubatorContext";
  import { buildApi } from "@/constants/api";
  import * as FileSystem from "expo-file-system";

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
    const { serverUrl } = useIncubator();
    // Pakai ref agar API object tidak trigger re-render / infinite loop
    const apiRef = useRef(buildApi(serverUrl));
    useEffect(() => {
      apiRef.current = buildApi(serverUrl);
    }, [serverUrl]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState("");
    const [voiceState, setVoiceState] = useState<VoiceState>("idle");
    const [isCallMode, setIsCallMode] = useState(false);
    const [callTranscript, setCallTranscript] = useState("");
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const recordingRef = useRef<Audio.Recording | null>(null);
    const soundRef = useRef<Audio.Sound | null>(null);
    const scrollRef = useRef<ScrollView>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const waveAnim = useRef(new Animated.Value(0)).current;
    const topPad = Platform.OS === "web" ? 67 : insets.top;
    // Tab bar height — sama dengan kalkulasi di _layout.tsx
    const tabBarH = Platform.OS === "ios"
      ? 49 + insets.bottom
      : 50 + Math.max(insets.bottom + 12, 40);

    // ── Load riwayat chat dari server DB ────────────────────────────
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loadHistory = useCallback(async () => {
      setIsLoadingHistory(true);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(apiRef.current.chatHistory(100), { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data: Array<{ ts: number; role: string; content: string }> = await res.json();
        // Server kembalikan DESC (terbaru dulu) → balik ke ASC untuk tampilan
        const msgs: Message[] = data.reverse().map((r, i) => ({
          id: `hist_${r.ts}_${i}`,
          role: r.role as "user" | "assistant",
          content: r.content,
          ts: r.ts * 1000, // server: detik, app: milidetik
        }));
        setMessages(msgs);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
      } catch {
        // Offline atau server tidak tersedia — biarkan kosong, tidak perlu error
      } finally {
        setIsLoadingHistory(false);
      }
    // serverUrl sebagai dep — bukan API object — agar tidak loop
    }, [serverUrl]);

    useEffect(() => {
      loadHistory();
    }, [loadHistory]);

    // ── Hapus semua riwayat chat dari server DB ──────────────────────
    const deleteHistory = () => {
      Alert.alert(
        "Hapus Riwayat Chat",
        "Semua percakapan dengan TERRA akan dihapus permanen dari server. Lanjutkan?",
        [
          { text: "Batal", style: "cancel" },
          {
            text: "Hapus",
            style: "destructive",
            onPress: async () => {
              try {
                const res = await fetch(apiRef.current.chatClear, { method: "POST" });
                if (!res.ok) throw new Error("HTTP " + res.status);
                setMessages([]);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                Alert.alert("Gagal", "Tidak dapat menghapus riwayat. Periksa koneksi ke server.");
              }
            },
          },
        ]
      );
    };

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
        const localUri = FileSystem.cacheDirectory + "tts_" + Date.now() + ".mp3";
        const downloadRes = await FileSystem.downloadAsync(
          apiRef.current.tts,
          localUri,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice: "id-ID-GadisNeural" }),
          }
        );
        if (downloadRes.status !== 200) throw new Error("TTS failed: " + downloadRes.status);
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync({ uri: downloadRes.uri });
        soundRef.current = sound;
        await sound.playAsync();
        sound.setOnPlaybackStatusUpdate((s) => {
          if (s.isLoaded && s.didJustFinish) {
            setVoiceState("idle");
            FileSystem.deleteAsync(downloadRes.uri, { idempotent: true });
          }
        });
      } catch (e) {
        console.error("TTS error:", e);
        setVoiceState("idle");
      }
    };

    const sendText = async (text: string) => {
      if (!text.trim()) return;
      addMessage("user", text);
      setInputText("");
      try {
        const res = await fetch(apiRef.current.chat, {
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

        const sttRes = await fetch(apiRef.current.stt, { method: "POST", body: formData });
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
          <View style={styles.headerRight}>
            {/* Tombol hapus riwayat */}
            {messages.length > 0 && (
              <Pressable
                onPress={deleteHistory}
                style={({ pressed }) => [styles.iconBtn, {
                  backgroundColor: colors.destructive + "18",
                  borderColor: colors.destructive + "44",
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            )}
            {/* Tombol refresh riwayat */}
            <Pressable
              onPress={loadHistory}
              disabled={isLoadingHistory}
              style={({ pressed }) => [styles.iconBtn, {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                opacity: isLoadingHistory || pressed ? 0.5 : 1,
              }]}
            >
              <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
            </Pressable>
            {/* Tombol voice call */}
            <Pressable
              onPress={toggleCall}
              style={[styles.callToggle, {
                backgroundColor: isCallMode ? colors.accent + "22" : colors.card,
                borderColor: isCallMode ? colors.accent : colors.border,
              }]}
            >
              <Feather name={isCallMode ? "phone-off" : "phone"} size={18} color={isCallMode ? colors.accent : colors.mutedForeground} />
              <Text style={[styles.callToggleText, { color: isCallMode ? colors.accent : colors.mutedForeground }]}>
                {isCallMode ? "Akhiri" : "Voice"}
              </Text>
            </Pressable>
          </View>
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
          contentContainerStyle={[styles.chatList, { paddingBottom: 16 }]}
        >
          {/* Loading history indicator */}
          {isLoadingHistory && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                Memuat riwayat chat...
              </Text>
            </View>
          )}

          {/* Empty state — hanya tampil saat sudah selesai load dan memang kosong */}
          {!isLoadingHistory && messages.length === 0 && (
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

          {/* Pesan chat */}
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
            marginBottom: tabBarH,
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    avatar: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: "center", justifyContent: "center",
    },
    avatarText: { fontSize: 18, fontWeight: "700", color: "#4CAF50" },
    headerTitle: { fontSize: 16, fontWeight: "700" },
    headerSub: { fontSize: 11 },
    iconBtn: {
      width: 32, height: 32, borderRadius: 8,
      alignItems: "center", justifyContent: "center",
      borderWidth: 1,
    },
    callToggle: {
      flexDirection: "row", alignItems: "center", gap: 5,
      paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 8, borderWidth: 1,
    },
    callToggleText: { fontSize: 13, fontWeight: "600" },
    callBanner: {
      alignItems: "center", paddingVertical: 24, paddingHorizontal: 24,
      gap: 10,
    },
    callAvatarLarge: {
      width: 80, height: 80, borderRadius: 40,
      alignItems: "center", justifyContent: "center",
      borderWidth: 2,
    },
    callAvatarText: { fontSize: 40 },
    callStatus: { fontSize: 18, fontWeight: "700" },
    callTranscript: { fontSize: 13, fontStyle: "italic", textAlign: "center" },
    voiceBtn: {
      width: 64, height: 64, borderRadius: 32,
      alignItems: "center", justifyContent: "center",
    },
    voiceHint: { fontSize: 12 },
    loadingWrap: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 24,
    },
    loadingText: { fontSize: 13 },
    chatList: { padding: 16, gap: 12, flexGrow: 1 },
    emptyState: { flex: 1, alignItems: "center", paddingTop: 24, gap: 12 },
    emptyIcon: {
      width: 64, height: 64, borderRadius: 32,
      alignItems: "center", justifyContent: "center",
    },
    emptyTitle: { fontSize: 18, fontWeight: "700" },
    emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 },
    suggestion: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      width: "100%", padding: 12, borderRadius: 8, borderWidth: 1, gap: 8,
    },
    suggestionText: { fontSize: 14, flex: 1 },
    bubble: { maxWidth: "85%", borderRadius: 12, padding: 10 },
    bubbleUser: { alignSelf: "flex-end" },
    bubbleAssistant: { alignSelf: "flex-start", borderWidth: 1 },
    bubbleName: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
    bubbleText: { fontSize: 14, lineHeight: 20 },
    inputBar: {
      flexDirection: "row", alignItems: "flex-end",
      gap: 8, padding: 10, borderTopWidth: 1,
    },
    micBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: "center", justifyContent: "center", borderWidth: 1,
    },
    textInput: {
      flex: 1, borderRadius: 20, paddingHorizontal: 14,
      paddingVertical: 10, fontSize: 15, maxHeight: 100,
    },
    sendBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: "center", justifyContent: "center",
    },
  });
  