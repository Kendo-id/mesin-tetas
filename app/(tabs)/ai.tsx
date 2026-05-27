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
  import * as Clipboard from "expo-clipboard";

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
  type Feedback = "up" | "down";

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatDateTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  export default function AIScreen() {
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const { serverUrl } = useIncubator();
    const apiRef = useRef(buildApi(serverUrl));
    useEffect(() => { apiRef.current = buildApi(serverUrl); }, [serverUrl]);

    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState("");
    const [voiceState, setVoiceState] = useState<VoiceState>("idle");
    const [isCallMode, setIsCallMode] = useState(false);
    const [callTranscript, setCallTranscript] = useState("");
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [ttsEnabled, setTtsEnabled] = useState(false);
    const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
    const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
    const [feedbackMap, setFeedbackMap] = useState<Record<string, Feedback>>({});

    const recordingRef = useRef<Audio.Recording | null>(null);
    const soundRef    = useRef<Audio.Sound | null>(null);
    const scrollRef   = useRef<ScrollView>(null);
    const pulseAnim   = useRef(new Animated.Value(1)).current;
    const waveAnim    = useRef(new Animated.Value(0)).current;

    const topPad  = Platform.OS === "web" ? 67 : insets.top;
    const tabBarH = Platform.OS === "ios"
      ? 49 + insets.bottom
      : 50 + Math.max(insets.bottom + 12, 40);

    const loadHistory = useCallback(async () => {
      setIsLoadingHistory(true);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(apiRef.current.chatHistory(100), { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data: Array<{ ts: number; role: string; content: string }> = await res.json();
        const msgs: Message[] = data.reverse().map((r, i) => ({
          id: `hist_${r.ts}_${i}`,
          role: r.role as "user" | "assistant",
          content: r.content,
          ts: r.ts * 1000,
        }));
        setMessages(msgs);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
      } catch { /* offline */ } finally { setIsLoadingHistory(false); }
    }, [serverUrl]);

    useEffect(() => { loadHistory(); }, [loadHistory]);

    const deleteHistory = () => {
      Alert.alert("Hapus Riwayat Chat", "Semua percakapan akan dihapus permanen. Lanjutkan?", [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus", style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(apiRef.current.chatClear, { method: "POST" });
              if (!res.ok) throw new Error();
              setMessages([]);
              setFeedbackMap({});
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch { Alert.alert("Gagal", "Tidak dapat menghapus riwayat."); }
          },
        },
      ]);
    };

    useEffect(() => {
      if (voiceState === "recording") {
        Animated.loop(Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])).start();
        Animated.loop(Animated.timing(waveAnim, { toValue: 1, duration: 1200, useNativeDriver: false })).start();
      } else {
        pulseAnim.stopAnimation(); pulseAnim.setValue(1);
        waveAnim.stopAnimation();  waveAnim.setValue(0);
      }
    }, [voiceState]);

    const addMessage = useCallback((role: "user" | "assistant", content: string): Message => {
      const msg: Message = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        role, content, ts: Date.now(),
      };
      setMessages(prev => [...prev, msg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return msg;
    }, []);

    const stopTTS = async () => {
      try {
        if (soundRef.current) {
          await soundRef.current.stopAsync().catch(() => {});
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      } catch {}
      setVoiceState("idle"); setSpeakingMsgId(null);
    };

    const playTTS = async (text: string, msgId?: string) => {
      await stopTTS();
      try {
        setVoiceState("playing");
        if (msgId) setSpeakingMsgId(msgId);
        const localUri = FileSystem.cacheDirectory + "tts_" + Date.now() + ".mp3";
        const dlRes = await FileSystem.downloadAsync(
          apiRef.current.tts, localUri,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice: "id-ID-GadisNeural" }) }
        );
        if (dlRes.status !== 200) throw new Error("TTS " + dlRes.status);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
        const { sound } = await Audio.Sound.createAsync({ uri: dlRes.uri });
        soundRef.current = sound;
        await sound.playAsync();
        sound.setOnPlaybackStatusUpdate(s => {
          if (s.isLoaded && s.didJustFinish) {
            setVoiceState("idle"); setSpeakingMsgId(null);
            FileSystem.deleteAsync(dlRes.uri, { idempotent: true });
          }
        });
      } catch { setVoiceState("idle"); setSpeakingMsgId(null); }
    };

    const handleBubbleTTS = async (msg: Message) => {
      if (speakingMsgId === msg.id && voiceState === "playing") await stopTTS();
      else await playTTS(msg.content, msg.id);
    };

    const copyToClipboard = async (msg: Message) => {
      await Clipboard.setStringAsync(msg.content);
      setCopiedMsgId(msg.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => setCopiedMsgId(null), 2000);
    };

    const sendFeedback = async (msg: Message, vote: Feedback) => {
      const current = feedbackMap[msg.id];
      const newVote = current === vote ? undefined : vote;
      setFeedbackMap(prev => {
        const next = { ...prev };
        if (newVote) next[msg.id] = newVote; else delete next[msg.id];
        return next;
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await fetch(apiRef.current.chatFeedback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msg_ts: Math.floor(msg.ts / 1000),
            content: msg.content,
            feedback: newVote ?? null,
          }),
        });
      } catch { /* ignore — UI sudah update */ }
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
        const aMsg = addMessage("assistant", reply);
        if (isCallMode || ttsEnabled) await playTTS(reply, aMsg.id);
      } catch { addMessage("assistant", "Maaf, gagal terhubung ke TERRA."); }
    };

    const startRecording = async () => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== "granted") { addMessage("assistant", "Izin mikrofon diperlukan."); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recordingRef.current = recording;
        setVoiceState("recording");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch { setVoiceState("idle"); }
    };

    const stopRecordingAndSend = async () => {
      if (!recordingRef.current) return;
      setVoiceState("processing");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        if (!uri) throw new Error("No URI");
        const form = new FormData();
        form.append("audio", { uri, name: "recording.m4a", type: "audio/m4a" } as unknown as Blob);
        form.append("lang", "id");
        const sttRes = await fetch(apiRef.current.stt, { method: "POST", body: form });
        const sttData = await sttRes.json();
        const transcript = sttData.text || "";
        setCallTranscript(transcript);
        if (transcript) await sendText(transcript); else setVoiceState("idle");
      } catch { setVoiceState("idle"); }
    };

    const toggleCall = () => {
      setIsCallMode(v => {
        if (!v) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          addMessage("assistant", "Halo! Saya TERRA. Tekan tombol mikrofon untuk berbicara.");
        }
        return !v;
      });
    };

    const voiceButtonAction = () => {
      if (voiceState === "recording") stopRecordingAndSend();
      else if (voiceState === "idle") startRecording();
    };

    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
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
            {messages.length > 0 && (
              <Pressable onPress={deleteHistory}
                style={({ pressed }) => [styles.iconBtn, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "44", opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            )}
            <Pressable onPress={loadHistory} disabled={isLoadingHistory}
              style={({ pressed }) => [styles.iconBtn, { backgroundColor: colors.muted, borderColor: colors.border, opacity: isLoadingHistory || pressed ? 0.5 : 1 }]}>
              <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={toggleCall}
              style={[styles.callToggle, { backgroundColor: isCallMode ? colors.accent + "22" : colors.card, borderColor: isCallMode ? colors.accent : colors.border }]}>
              <Feather name={isCallMode ? "phone-off" : "phone"} size={18} color={isCallMode ? colors.accent : colors.mutedForeground} />
              <Text style={[styles.callToggleText, { color: isCallMode ? colors.accent : colors.mutedForeground }]}>
                {isCallMode ? "Akhiri" : "Voice"}
              </Text>
            </Pressable>
          </View>
        </View>

        {isCallMode && (
          <LinearGradient colors={[colors.card, colors.background]} style={styles.callBanner}>
            <View style={[styles.callAvatarLarge, {
              backgroundColor: voiceState === "recording" ? colors.destructive + "22" : voiceState === "processing" ? colors.warning + "22" : voiceState === "playing" ? colors.accent + "22" : colors.primary + "22",
              borderColor: voiceState === "recording" ? colors.destructive : voiceState === "processing" ? colors.warning : voiceState === "playing" ? colors.accent : colors.primary,
            }]}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Text style={styles.callAvatarText}>T</Text>
              </Animated.View>
            </View>
            <Text style={[styles.callStatus, { color: colors.foreground }]}>
              {voiceState === "recording" ? "Mendengarkan..." : voiceState === "processing" ? "Memproses..." : voiceState === "playing" ? "TERRA berbicara..." : "TERRA siap"}
            </Text>
            {callTranscript ? <Text style={[styles.callTranscript, { color: colors.mutedForeground }]} numberOfLines={2}>"{callTranscript}"</Text> : null}
            <Pressable onPress={voiceButtonAction} disabled={voiceState === "processing" || voiceState === "playing"}
              style={({ pressed }) => [styles.voiceBtn, { backgroundColor: voiceState === "recording" ? colors.destructive : colors.primary, opacity: (voiceState === "processing" || voiceState === "playing") ? 0.5 : pressed ? 0.8 : 1 }]}>
              <Feather name={voiceState === "recording" ? "square" : "mic"} size={28} color="#fff" />
            </Pressable>
            <Text style={[styles.voiceHint, { color: colors.mutedForeground }]}>
              {voiceState === "recording" ? "Tap untuk berhenti" : "Tap untuk bicara"}
            </Text>
          </LinearGradient>
        )}

        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.chatList, { paddingBottom: 16 }]}>
          {isLoadingHistory && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Memuat riwayat chat...</Text>
            </View>
          )}
          {!isLoadingHistory && messages.length === 0 && (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primary + "22" }]}>
                <Feather name="message-circle" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Tanya TERRA</Text>
              <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
                Tanya kondisi mesin, minta kontrol perangkat, atau buat sesi inkubasi baru.
              </Text>
              {["Suhu mesin sekarang berapa?", "Nyalakan heater", "Buat sesi inkubasi ayam 100 telur"].map(s => (
                <Pressable key={s} onPress={() => sendText(s)}
                  style={({ pressed }) => [styles.suggestion, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}>
                  <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
                  <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}

          {messages.map(msg => (
            <View key={msg.id} style={msg.role === "user" ? styles.msgWrapUser : styles.msgWrapAssistant}>
              <View style={[
                styles.bubble,
                msg.role === "user"
                  ? [styles.bubbleUser, { backgroundColor: colors.primary }]
                  : [styles.bubbleAssistant, { backgroundColor: colors.card, borderColor: colors.border }],
              ]}>
                {msg.role === "assistant" && (
                  <Text style={[styles.bubbleName, { color: colors.primary }]}>TERRA</Text>
                )}
                <Text style={[styles.bubbleText, { color: msg.role === "user" ? "#fff" : colors.foreground }]}>
                  {msg.content}
                </Text>

                {msg.role === "assistant" ? (
                  <View style={[styles.bubbleFooter, { borderTopColor: colors.border + "50" }]}>
                    <Pressable onPress={() => handleBubbleTTS(msg)}
                      disabled={voiceState === "processing" || voiceState === "recording"}
                      style={({ pressed }) => [styles.footerBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather
                        name={speakingMsgId === msg.id && voiceState === "playing" ? "volume-x" : "volume-2"}
                        size={15}
                        color={speakingMsgId === msg.id ? colors.accent : colors.mutedForeground}
                      />
                    </Pressable>

                    <Pressable onPress={() => copyToClipboard(msg)}
                      style={({ pressed }) => [styles.footerBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather
                        name={copiedMsgId === msg.id ? "check" : "copy"}
                        size={15}
                        color={copiedMsgId === msg.id ? colors.primary : colors.mutedForeground}
                      />
                    </Pressable>

                    <Pressable onPress={() => sendFeedback(msg, "up")}
                      style={({ pressed }) => [styles.footerBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather
                        name="thumbs-up"
                        size={15}
                        color={feedbackMap[msg.id] === "up" ? colors.primary : colors.mutedForeground}
                      />
                    </Pressable>

                    <Pressable onPress={() => sendFeedback(msg, "down")}
                      style={({ pressed }) => [styles.footerBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather
                        name="thumbs-down"
                        size={15}
                        color={feedbackMap[msg.id] === "down" ? colors.destructive : colors.mutedForeground}
                      />
                    </Pressable>

                    <View style={{ flex: 1 }} />
                    <Text style={[styles.footerTime, { color: colors.mutedForeground }]}>
                      {formatTime(msg.ts)}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.userTime, { color: "rgba(255,255,255,0.55)" }]}>
                    {formatDateTime(msg.ts)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {!isCallMode && (
          <View style={[styles.inputBar, {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16),
            marginBottom: tabBarH,
          }]}>
            <Pressable onPress={voiceButtonAction} disabled={voiceState === "processing"}
              style={[styles.circleBtn, {
                backgroundColor: voiceState === "recording" ? colors.destructive + "22" : colors.muted,
                borderColor: voiceState === "recording" ? colors.destructive : colors.border,
              }]}>
              <Feather name={voiceState === "recording" ? "square" : "mic"} size={20}
                color={voiceState === "recording" ? colors.destructive : colors.mutedForeground} />
            </Pressable>

            <Pressable onPress={() => { setTtsEnabled(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[styles.circleBtn, {
                backgroundColor: ttsEnabled ? colors.accent + "22" : colors.muted,
                borderColor: ttsEnabled ? colors.accent : colors.border,
              }]}>
              <Feather name={ttsEnabled ? "volume-2" : "volume-x"} size={20}
                color={ttsEnabled ? colors.accent : colors.mutedForeground} />
            </Pressable>

            <TextInput
              value={inputText} onChangeText={setInputText}
              placeholder="Ketik pesan..." placeholderTextColor={colors.mutedForeground}
              style={[styles.textInput, { backgroundColor: colors.muted, color: colors.foreground }]}
              onSubmitEditing={() => sendText(inputText)}
              returnKeyType="send" multiline
            />
            <Pressable onPress={() => sendText(inputText)} disabled={!inputText.trim()}
              style={({ pressed }) => [styles.sendBtn, {
                backgroundColor: inputText.trim() ? colors.primary : colors.muted,
                opacity: pressed ? 0.8 : 1,
              }]}>
              <Feather name="send" size={18} color={inputText.trim() ? "#fff" : colors.mutedForeground} />
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 18, fontWeight: "700", color: "#4CAF50" },
    headerTitle: { fontSize: 16, fontWeight: "700" },
    headerSub: { fontSize: 11 },
    iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    callToggle: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
    callToggleText: { fontSize: 13, fontWeight: "600" },
    callBanner: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 24, gap: 10 },
    callAvatarLarge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", borderWidth: 2 },
    callAvatarText: { fontSize: 40 },
    callStatus: { fontSize: 18, fontWeight: "700" },
    callTranscript: { fontSize: 13, fontStyle: "italic", textAlign: "center" },
    voiceBtn: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
    voiceHint: { fontSize: 12 },
    loadingWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 24 },
    loadingText: { fontSize: 13 },
    chatList: { padding: 16, gap: 10, flexGrow: 1 },
    emptyState: { flex: 1, alignItems: "center", paddingTop: 24, gap: 12 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
    emptyTitle: { fontSize: 18, fontWeight: "700" },
    emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 },
    suggestion: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", padding: 12, borderRadius: 8, borderWidth: 1, gap: 8 },
    suggestionText: { fontSize: 14, flex: 1 },
    msgWrapUser: { alignItems: "flex-end" },
    msgWrapAssistant: { alignItems: "flex-start" },
    bubble: { maxWidth: "86%", borderRadius: 14, overflow: "hidden" },
    bubbleUser: { alignSelf: "flex-end", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
    bubbleAssistant: { alignSelf: "flex-start", borderWidth: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 0 },
    bubbleName: { fontSize: 11, fontWeight: "700", marginBottom: 3 },
    bubbleText: { fontSize: 14, lineHeight: 21 },
    bubbleFooter: { flexDirection: "row", alignItems: "center", marginTop: 8, paddingTop: 6, paddingBottom: 7, borderTopWidth: 1 },
    footerBtn: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
    footerTime: { fontSize: 11 },
    userTime: { fontSize: 10, marginTop: 4, textAlign: "right", paddingBottom: 8 },
    inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1 },
    circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    textInput: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 14, maxHeight: 100 },
    sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  });
  