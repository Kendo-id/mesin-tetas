import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
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
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useIncubator } from "@/context/IncubatorContext";
import { buildApi } from "@/constants/api";

// ── Types ──────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}
type VoiceState = "idle" | "recording" | "processing" | "playing";
type Feedback = "up" | "down";

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDateTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${fmtTime(ts)}`;
}

// Init Audio mode ONCE at module level — expo-av v16 requirement
let audioModeSet = false;
async function ensureAudioMode() {
  if (audioModeSet) return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
    audioModeSet = true;
  } catch (_) {}
}

// ── Component ──────────────────────────────────────────────────────────────
export default function AIScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { serverUrl } = useIncubator();
  const apiRef = useRef(buildApi(serverUrl));
  useEffect(() => { apiRef.current = buildApi(serverUrl); }, [serverUrl]);

  // ── State ────────────────────────────────────────────────────────────────
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; title: string; ts: number }[]>([]);

  const ttsEnabledRef = useRef(false);
  const isCallModeRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sidebarAnim = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const tabBarH = Platform.OS === "ios"
    ? 49 + insets.bottom
    : 50 + Math.max(insets.bottom + 12, 40);

  // ── Persist TTS pref ─────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("terra_tts_autoplay").then(v => {
      const on = v === "1";
      setTtsEnabled(on);
      ttsEnabledRef.current = on;
    }).catch(() => {});
    ensureAudioMode();
  }, []);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
    AsyncStorage.setItem("terra_tts_autoplay", ttsEnabled ? "1" : "0").catch(() => {});
  }, [ttsEnabled]);

  useEffect(() => { isCallModeRef.current = isCallMode; }, [isCallMode]);

  // ── Sidebar animation ─────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(sidebarAnim, {
      toValue: sidebarOpen ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [sidebarOpen]);

  // ── Recording pulse ───────────────────────────────────────────────────────
  useEffect(() => {
    if (voiceState === "recording") {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [voiceState]);

  // ── History ───────────────────────────────────────────────────────────────
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
      // Build sidebar sessions from history (group by day)
      const byDay: Record<string, Message[]> = {};
      msgs.forEach(m => {
        const key = new Date(m.ts).toDateString();
        if (!byDay[key]) byDay[key] = [];
        byDay[key].push(m);
      });
      const sess = Object.entries(byDay).map(([day, ms]) => ({
        id: day,
        title: ms.find(m => m.role === "user")?.content.slice(0, 40) ?? day,
        ts: ms[0].ts,
      })).reverse();
      setSessions(sess);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
    } catch { /* offline */ }
    finally { setIsLoadingHistory(false); }
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
            setSessions([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch { Alert.alert("Gagal", "Tidak dapat menghapus riwayat."); }
        },
      },
    ]);
  };

  // ── TTS ───────────────────────────────────────────────────────────────────
  const stopTTS = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync().catch(() => {});
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    } catch {}
    setVoiceState("idle");
    setSpeakingMsgId(null);
  };

  const playTTS = async (text: string, msgId?: string) => {
    await stopTTS();
    const localUri = (FileSystem.cacheDirectory ?? "") + "tts_" + Date.now() + ".mp3";
    try {
      setVoiceState("playing");
      if (msgId) setSpeakingMsgId(msgId);

      await ensureAudioMode();

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(apiRef.current.tts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "id-ID-GadisNeural" }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error("TTS HTTP " + res.status);

      const ab = await res.arrayBuffer();
      if (!ab || ab.byteLength < 50) throw new Error("TTS audio kosong");

      // chunked btoa — paling kompatibel di Hermes/Android
      const bytes = new Uint8Array(ab);
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
      }
      const base64 = btoa(binary);

      await FileSystem.writeAsStringAsync(localUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // create tanpa shouldPlay dulu, lalu playAsync — lebih andal di expo-av v16
      const { sound } = await Audio.Sound.createAsync(
        { uri: localUri },
        { shouldPlay: false, progressUpdateIntervalMillis: 500 }
      );
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate(s => {
        if (s.isLoaded && s.didJustFinish) {
          setVoiceState("idle");
          setSpeakingMsgId(null);
          soundRef.current = null;
          FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
        }
      });

      await sound.playAsync();
    } catch (e) {
      console.error("TTS error:", e);
      setVoiceState("idle");
      setSpeakingMsgId(null);
      FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    }
  };

  const handleBubbleTTS = async (msg: Message) => {
    if (speakingMsgId === msg.id && voiceState === "playing") await stopTTS();
    else await playTTS(msg.content, msg.id);
  };

  // ── Clipboard ─────────────────────────────────────────────────────────────
  const copyToClipboard = async (msg: Message) => {
    await Clipboard.setStringAsync(msg.content);
    setCopiedMsgId(msg.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // ── Feedback ──────────────────────────────────────────────────────────────
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
        body: JSON.stringify({ msg_ts: Math.floor(msg.ts / 1000), content: msg.content, feedback: newVote ?? null }),
      });
    } catch {}
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const addMessage = useCallback((role: "user" | "assistant", content: string): Message => {
    const msg: Message = { id: Date.now().toString() + Math.random().toString(36).slice(2), role, content, ts: Date.now() };
    setMessages(prev => [...prev, msg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return msg;
  }, []);

  const sendText = async (text: string) => {
    if (!text.trim()) return;
    if (!isCallModeRef.current) addMessage("user", text);
    setInputText("");
    if (sidebarOpen) setSidebarOpen(false);
    try {
      const res = await fetch(apiRef.current.chat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply || "Tidak ada respons.";
      if (isCallModeRef.current) {
        await playTTS(reply);
      } else {
        const aMsg = addMessage("assistant", reply);
        if (ttsEnabledRef.current) await playTTS(reply, aMsg.id);
      }
    } catch {
      if (!isCallModeRef.current) addMessage("assistant", "Maaf, gagal terhubung ke TERRA.");
    }
  };

  // ── Voice ─────────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") { addMessage("assistant", "Izin mikrofon diperlukan."); return; }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
      audioModeSet = false; // reset so next playTTS re-sets for playback
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
      if (transcript) await sendText(transcript);
      else setVoiceState("idle");
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

  // ── UI token shortcuts ───────────────────────────────────────────────────
  const C = colors;
  const ACCENT = "#d97706";
  const ACCENT2 = "#f59e0b";
  const BG = C.background;
  const SURF = C.card;
  const BORDER = C.border;
  const TEXT = C.foreground;
  const TEXT2 = C.mutedForeground;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: BG }]}>
      <StatusBar barStyle="light-content" backgroundColor={SURF} />

      {/* ── Sidebar overlay ── */}
      {sidebarOpen && (
        <Pressable style={styles.overlay} onPress={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <Animated.View style={[
        styles.sidebar,
        {
          backgroundColor: SURF,
          borderRightColor: BORDER,
          width: sidebarAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 260] }),
          opacity: sidebarAnim,
        }
      ]}>
        {/* Sidebar header */}
        <View style={[styles.sbHead, { borderBottomColor: BORDER }]}>
          <View style={styles.sbLogo}>
            <View style={[styles.sbLogoIcon, { backgroundColor: ACCENT }]}>
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>T</Text>
            </View>
            <Text style={[styles.sbLogoName, { color: TEXT }]}>TERRA AI</Text>
          </View>
          <Pressable onPress={() => { setMessages([]); setSidebarOpen(false); }}
            style={[styles.sbNewBtn, { backgroundColor: C.muted, borderColor: BORDER }]}>
            <Feather name="plus" size={14} color={TEXT2} />
            <Text style={[styles.sbNewTxt, { color: TEXT2 }]}>Chat baru</Text>
          </Pressable>
        </View>

        {/* Session list */}
        <ScrollView style={styles.sbList} showsVerticalScrollIndicator={false}>
          {sessions.length === 0 ? (
            <Text style={[styles.sbEmpty, { color: TEXT2 }]}>Belum ada riwayat chat</Text>
          ) : (
            sessions.map(s => (
              <Pressable key={s.id} style={({ pressed }) => [
                styles.sbItem, { backgroundColor: pressed ? C.muted : "transparent" }
              ]}>
                <Feather name="message-square" size={13} color={TEXT2} style={{ marginRight: 8 }} />
                <Text style={[styles.sbItemTitle, { color: TEXT }]} numberOfLines={1}>{s.title}</Text>
                <Text style={[styles.sbItemMeta, { color: TEXT2 }]}>{fmtDateTime(s.ts).slice(0, 5)}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>

        {/* Sidebar footer */}
        <View style={[styles.sbFoot, { borderTopColor: BORDER }]}>
          <Pressable onPress={deleteHistory} style={styles.sbFootBtn}>
            <Feather name="trash-2" size={14} color={TEXT2} />
            <Text style={[styles.sbFootTxt, { color: TEXT2 }]}>Hapus semua</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* ── Main area ── */}
      <View style={styles.main}>
        {/* Header */}
        <View style={[styles.header, {
          paddingTop: topPad + 8,
          backgroundColor: SURF,
          borderBottomColor: BORDER,
        }]}>
          <Pressable onPress={() => setSidebarOpen(v => !v)} style={styles.hdrBtn}>
            <Feather name={sidebarOpen ? "x" : "menu"} size={18} color={TEXT2} />
          </Pressable>

          <View style={styles.hdrModelPill}>
            <View style={[styles.hdrDot, { backgroundColor: C.accent }]} />
            <Text style={[styles.hdrModelTxt, { color: TEXT }]}>TERRA</Text>
            <Text style={[styles.hdrSubTxt, { color: TEXT2 }]}>AI Inkubator</Text>
          </View>

          <View style={{ flex: 1 }} />

          {/* TTS toggle */}
          <Pressable onPress={() => { setTtsEnabled(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[styles.hdrBtn, {
              backgroundColor: ttsEnabled ? ACCENT + "22" : "transparent",
              borderRadius: 8,
              borderWidth: ttsEnabled ? 1 : 0,
              borderColor: ACCENT,
            }]}>
            <Feather name={ttsEnabled ? "volume-2" : "volume-x"} size={17}
              color={ttsEnabled ? ACCENT2 : TEXT2} />
          </Pressable>

          {/* Voice call toggle */}
          <Pressable onPress={toggleCall}
            style={[styles.hdrCallPill, {
              backgroundColor: isCallMode ? ACCENT + "22" : SURF,
              borderColor: isCallMode ? ACCENT : BORDER,
            }]}>
            <Feather name={isCallMode ? "phone-off" : "phone"} size={16}
              color={isCallMode ? ACCENT2 : TEXT2} />
            <Text style={[styles.hdrCallTxt, { color: isCallMode ? ACCENT2 : TEXT2 }]}>
              {isCallMode ? "Akhiri" : "Voice"}
            </Text>
          </Pressable>
        </View>

        {/* Call banner */}
        {isCallMode && (
          <LinearGradient colors={[SURF, BG]} style={styles.callBanner}>
            <Animated.View style={[styles.callAvatar, {
              backgroundColor: voiceState === "recording" ? C.destructive + "22"
                : voiceState === "playing" ? ACCENT + "22" : C.primary + "22",
              borderColor: voiceState === "recording" ? C.destructive
                : voiceState === "playing" ? ACCENT : C.primary,
              transform: [{ scale: pulseAnim }],
            }]}>
              <Text style={styles.callAvatarTxt}>T</Text>
            </Animated.View>
            <Text style={[styles.callStatus, { color: TEXT }]}>
              {voiceState === "recording" ? "Mendengarkan..." : voiceState === "processing" ? "Memproses..." : voiceState === "playing" ? "TERRA berbicara..." : "TERRA siap"}
            </Text>
            {callTranscript ? <Text style={[styles.callTranscript, { color: TEXT2 }]} numberOfLines={2}>"{callTranscript}"</Text> : null}
            <Pressable onPress={voiceButtonAction} disabled={voiceState === "processing" || voiceState === "playing"}
              style={({ pressed }) => [styles.voiceBtn, {
                backgroundColor: voiceState === "recording" ? C.destructive : ACCENT,
                opacity: (voiceState === "processing" || voiceState === "playing") ? 0.5 : pressed ? 0.8 : 1,
              }]}>
              <Feather name={voiceState === "recording" ? "square" : "mic"} size={28} color="#fff" />
            </Pressable>
            <Text style={[styles.voiceHint, { color: TEXT2 }]}>
              {voiceState === "recording" ? "Tap untuk berhenti" : "Tap untuk bicara"}
            </Text>
          </LinearGradient>
        )}

        {/* Chat list */}
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.chatList, { paddingBottom: 16 }]}>
          {isLoadingHistory && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={ACCENT} />
              <Text style={[styles.loadingTxt, { color: TEXT2 }]}>Memuat riwayat...</Text>
            </View>
          )}

          {!isLoadingHistory && messages.length === 0 && (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: ACCENT + "22" }]}>
                <Text style={{ fontSize: 32 }}>🌡️</Text>
              </View>
              <Text style={[styles.emptyTitle, { color: TEXT }]}>Tanya TERRA</Text>
              <Text style={[styles.emptyDesc, { color: TEXT2 }]}>
                Tanya kondisi mesin, minta kontrol perangkat, atau buat sesi inkubasi baru.
              </Text>
              {["Suhu mesin sekarang berapa?", "Nyalakan heater", "Buat sesi inkubasi ayam 100 telur"].map(s => (
                <Pressable key={s} onPress={() => sendText(s)}
                  style={({ pressed }) => [styles.suggestion, {
                    backgroundColor: SURF, borderColor: BORDER, opacity: pressed ? 0.8 : 1,
                  }]}>
                  <Text style={[styles.suggestionTxt, { color: TEXT }]}>{s}</Text>
                  <Feather name="arrow-right" size={13} color={TEXT2} />
                </Pressable>
              ))}
            </View>
          )}

          {messages.map(msg => (
            <View key={msg.id} style={msg.role === "user" ? styles.wrapUser : styles.wrapBot}>
              <View style={[
                styles.bubble,
                msg.role === "user"
                  ? [styles.bubbleUser, { backgroundColor: C.primary }]
                  : [styles.bubbleBot, { backgroundColor: SURF, borderColor: BORDER }],
              ]}>
                {msg.role === "assistant" && (
                  <Text style={[styles.bubbleName, { color: ACCENT2 }]}>TERRA</Text>
                )}
                <Text style={[styles.bubbleTxt, { color: msg.role === "user" ? "#fff" : TEXT }]}>
                  {msg.content}
                </Text>
                {msg.role === "assistant" ? (
                  <View style={[styles.bubbleFooter, { borderTopColor: BORDER + "60" }]}>
                    <Pressable onPress={() => handleBubbleTTS(msg)}
                      disabled={voiceState === "processing" || voiceState === "recording"}
                      style={({ pressed }) => [styles.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather
                        name={speakingMsgId === msg.id && voiceState === "playing" ? "volume-x" : "volume-2"}
                        size={14}
                        color={speakingMsgId === msg.id ? ACCENT2 : TEXT2}
                      />
                    </Pressable>
                    <Pressable onPress={() => copyToClipboard(msg)}
                      style={({ pressed }) => [styles.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather name={copiedMsgId === msg.id ? "check" : "copy"} size={14}
                        color={copiedMsgId === msg.id ? C.primary : TEXT2} />
                    </Pressable>
                    <Pressable onPress={() => sendFeedback(msg, "up")}
                      style={({ pressed }) => [styles.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather name="thumbs-up" size={14}
                        color={feedbackMap[msg.id] === "up" ? C.primary : TEXT2} />
                    </Pressable>
                    <Pressable onPress={() => sendFeedback(msg, "down")}
                      style={({ pressed }) => [styles.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                      <Feather name="thumbs-down" size={14}
                        color={feedbackMap[msg.id] === "down" ? C.destructive : TEXT2} />
                    </Pressable>
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.footTime, { color: TEXT2 }]}>{fmtTime(msg.ts)}</Text>
                  </View>
                ) : (
                  <Text style={[styles.userTime, { color: "rgba(255,255,255,0.55)" }]}>
                    {fmtDateTime(msg.ts)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Input bar */}
        {!isCallMode && (
          <View style={[styles.inputBar, {
            backgroundColor: SURF,
            borderTopColor: BORDER,
            paddingBottom: Math.max(insets.bottom, 10),
            marginBottom: tabBarH,
          }]}>
            <Pressable onPress={voiceButtonAction} disabled={voiceState === "processing"}
              style={[styles.circleBtn, {
                backgroundColor: voiceState === "recording" ? C.destructive + "22" : C.muted,
                borderColor: voiceState === "recording" ? C.destructive : BORDER,
              }]}>
              <Feather name={voiceState === "recording" ? "square" : "mic"} size={18}
                color={voiceState === "recording" ? C.destructive : TEXT2} />
            </Pressable>

            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ketik pesan ke TERRA..."
              placeholderTextColor={TEXT2}
              style={[styles.textInput, { backgroundColor: C.muted, color: TEXT }]}
              onSubmitEditing={() => sendText(inputText)}
              returnKeyType="send"
              multiline
            />

            <Pressable onPress={() => sendText(inputText)} disabled={!inputText.trim()}
              style={({ pressed }) => [styles.sendBtn, {
                backgroundColor: inputText.trim() ? ACCENT : C.muted,
                opacity: pressed ? 0.8 : 1,
              }]}>
              <Feather name="send" size={17} color={inputText.trim() ? "#fff" : TEXT2} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row" },

  // Overlay
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: "rgba(0,0,0,0.4)" },

  // Sidebar
  sidebar: { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 20, borderRightWidth: 1, overflow: "hidden" },
  sbHead: { padding: 14, borderBottomWidth: 1 },
  sbLogo: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  sbLogoIcon: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", marginRight: 8 },
  sbLogoName: { fontSize: 15, fontWeight: "700" },
  sbNewBtn: { flexDirection: "row", alignItems: "center", padding: 8, borderRadius: 8, borderWidth: 1 },
  sbNewTxt: { fontSize: 13, marginLeft: 6 },
  sbList: { flex: 1, padding: 8 },
  sbEmpty: { fontSize: 13, textAlign: "center", marginTop: 24, lineHeight: 20 },
  sbItem: { flexDirection: "row", alignItems: "center", padding: 8, borderRadius: 8, marginBottom: 2 },
  sbItemTitle: { flex: 1, fontSize: 13 },
  sbItemMeta: { fontSize: 11 },
  sbFoot: { padding: 12, borderTopWidth: 1 },
  sbFootBtn: { flexDirection: "row", alignItems: "center", padding: 6 },
  sbFootTxt: { fontSize: 13, marginLeft: 6 },

  // Main
  main: { flex: 1 },

  // Header
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1 },
  hdrBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  hdrModelPill: { flexDirection: "row", alignItems: "center", marginLeft: 4 },
  hdrDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  hdrModelTxt: { fontSize: 15, fontWeight: "700", marginRight: 4 },
  hdrSubTxt: { fontSize: 11 },
  hdrCallPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, marginLeft: 4 },
  hdrCallTxt: { fontSize: 13, fontWeight: "600", marginLeft: 4 },

  // Call
  callBanner: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 24 },
  callAvatar: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", borderWidth: 2, marginBottom: 10 },
  callAvatarTxt: { fontSize: 36, fontWeight: "700", color: "#4CAF50" },
  callStatus: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  callTranscript: { fontSize: 13, fontStyle: "italic", textAlign: "center", marginBottom: 8 },
  voiceBtn: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginTop: 8 },
  voiceHint: { fontSize: 12, marginTop: 8 },

  // Chat
  chatList: { padding: 16, flexGrow: 1 },
  loadingWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  loadingTxt: { fontSize: 13, marginLeft: 8 },
  empty: { flex: 1, alignItems: "center", paddingTop: 40 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280, marginBottom: 16 },
  suggestion: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  suggestionTxt: { fontSize: 14, flex: 1 },

  // Bubbles
  wrapUser: { alignItems: "flex-end", marginBottom: 8 },
  wrapBot: { alignItems: "flex-start", marginBottom: 8 },
  bubble: { maxWidth: "86%", borderRadius: 14, overflow: "hidden" },
  bubbleUser: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  bubbleBot: { borderWidth: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 0 },
  bubbleName: { fontSize: 11, fontWeight: "700", marginBottom: 3 },
  bubbleTxt: { fontSize: 14, lineHeight: 21 },
  bubbleFooter: { flexDirection: "row", alignItems: "center", marginTop: 8, paddingTop: 6, paddingBottom: 7, borderTopWidth: 1 },
  footBtn: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5 },
  footTime: { fontSize: 11 },
  userTime: { fontSize: 10, marginTop: 4, textAlign: "right", paddingBottom: 8 },

  // Input
  inputBar: { flexDirection: "row", alignItems: "flex-end", padding: 10, borderTopWidth: 1 },
  circleBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, marginRight: 6 },
  textInput: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 14, maxHeight: 100, marginRight: 6 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
