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
    TouchableWithoutFeedback,
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

  // ─── Types ────────────────────────────────────────────────────────────────────
  interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    ts: number;
  }
  type VoiceState = "idle" | "recording" | "processing" | "playing";
  type Feedback   = "up" | "down";

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function fmtTime(ts: number) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtDate(ts: number) {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  let _audioModeReady = false;
  async function setPlaybackMode() {
    if (_audioModeReady) return;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
    _audioModeReady = true;
  }
  async function setRecordingMode() {
    _audioModeReady = false;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
  }

  // ─── Component ────────────────────────────────────────────────────────────────
  export default function AIScreen() {
    const colors  = useColors();
    const insets  = useSafeAreaInsets();
    const { serverUrl } = useIncubator();
    const apiRef  = useRef(buildApi(serverUrl));
    useEffect(() => { apiRef.current = buildApi(serverUrl); }, [serverUrl]);

    const [messages,       setMessages]       = useState<Message[]>([]);
    const [inputText,      setInputText]      = useState("");
    const [voiceState,     setVoiceState]     = useState<VoiceState>("idle");
    const [isCallMode,     setIsCallMode]     = useState(false);
    const [callTranscript, setCallTranscript] = useState("");
    const [callCountdown,  setCallCountdown]  = useState(0);
    const [isLoadingHist,  setIsLoadingHist]  = useState(true);
    const [ttsEnabled,     setTtsEnabled]     = useState(false);
    const [speakingId,     setSpeakingId]     = useState<string | null>(null);
    const [copiedId,       setCopiedId]       = useState<string | null>(null);
    const [feedbackMap,    setFeedbackMap]    = useState<Record<string, Feedback>>({});
    const [sidebarOpen,    setSidebarOpen]    = useState(false);
    const [ttsError,       setTtsError]       = useState<string | null>(null);

    const ttsEnabledRef  = useRef(false);
    const isCallRef      = useRef(false);
    const autoCallRef    = useRef(false);
    const recordingRef   = useRef<Audio.Recording | null>(null);
    const soundRef       = useRef<Audio.Sound | null>(null);
    const ttsResolveRef  = useRef<(() => void) | null>(null);
    const callTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
    const scrollRef      = useRef<ScrollView>(null);
    const pulseAnim      = useRef(new Animated.Value(1)).current;
    const countdownAnim  = useRef(new Animated.Value(1)).current;
    const sbAnim         = useRef(new Animated.Value(0)).current;

    const topPad  = Platform.OS === "web" ? 67 : insets.top;
    const tabBarH = Platform.OS === "ios"
      ? 49 + insets.bottom
      : 50 + Math.max(insets.bottom + 12, 40);

    useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);
    useEffect(() => { isCallRef.current = isCallMode; }, [isCallMode]);

    useEffect(() => {
      AsyncStorage.getItem("terra_tts_autoplay").then(v => {
        const on = v === "1";
        setTtsEnabled(on);
        ttsEnabledRef.current = on;
      }).catch(() => {});
      setPlaybackMode().catch(() => {});
    }, []);

    useEffect(() => {
      AsyncStorage.setItem("terra_tts_autoplay", ttsEnabled ? "1" : "0").catch(() => {});
    }, [ttsEnabled]);

    useEffect(() => {
      Animated.timing(sbAnim, {
        toValue: sidebarOpen ? 1 : 0,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    }, [sidebarOpen]);

    useEffect(() => {
      if (voiceState === "recording") {
        Animated.loop(Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.22, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])).start();
      } else {
        pulseAnim.stopAnimation();
        pulseAnim.setValue(1);
      }
    }, [voiceState]);

    // ── History ────────────────────────────────────────────────────────────────
    const loadHistory = useCallback(async () => {
      setIsLoadingHist(true);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(apiRef.current.chatHistory(100), { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data: Array<{ ts: number; role: string; content: string }> = await res.json();
        const msgs: Message[] = data.reverse().map((r, i) => ({
          id: `h_${r.ts}_${i}`,
          role: r.role as "user" | "assistant",
          content: r.content,
          ts: r.ts * 1000,
        }));
        setMessages(msgs);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
      } catch { /* offline */ }
      finally { setIsLoadingHist(false); }
    }, [serverUrl]);

    useEffect(() => { loadHistory(); }, [loadHistory]);

    const deleteHistory = () => {
      Alert.alert("Hapus Riwayat Chat", "Semua percakapan akan dihapus permanen. Lanjutkan?", [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus", style: "destructive", onPress: async () => {
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

    // ── TTS — resolves ONLY after playback fully ends (or stopTTS cancels it) ──
    const stopTTS = async () => {
      if (ttsResolveRef.current) {
        ttsResolveRef.current();
        ttsResolveRef.current = null;
      }
      try {
        if (soundRef.current) {
          await soundRef.current.stopAsync().catch(() => {});
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      } catch {}
      setVoiceState("idle");
      setSpeakingId(null);
    };

    const playTTS = async (text: string, msgId?: string): Promise<boolean> => {
      await stopTTS();
      const localUri = (FileSystem.cacheDirectory ?? "") + "tts_" + Date.now() + ".mp3";
      try {
        setVoiceState("playing");
        if (msgId) setSpeakingId(msgId);
        setTtsError(null);
        await setPlaybackMode();

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        const res = await fetch(apiRef.current.tts, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: "su-ID-TutiNeural" }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`TTS server error ${res.status}: ${errBody.slice(0, 120)}`);
        }

        const ab = await res.arrayBuffer();
        if (!ab || ab.byteLength < 50) throw new Error("TTS: audio response kosong");

        const bytes = new Uint8Array(ab);
        let binary = "";
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
        }
        await FileSystem.writeAsStringAsync(localUri, btoa(binary), {
          encoding: FileSystem.EncodingType.Base64,
        });

        const { sound } = await Audio.Sound.createAsync({ uri: localUri }, { shouldPlay: false });
        soundRef.current = sound;

        // Await until didJustFinish OR stopTTS resolves ttsResolveRef
        await new Promise<void>(resolve => {
          ttsResolveRef.current = resolve;
          sound.setOnPlaybackStatusUpdate(s => {
            if (s.isLoaded && s.didJustFinish) {
              if (ttsResolveRef.current === resolve) ttsResolveRef.current = null;
              setVoiceState("idle");
              setSpeakingId(null);
              soundRef.current = null;
              FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
              resolve();
            }
          });
          sound.playAsync().catch(() => resolve());
        });

        return true;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error("TTS error:", msg);
        setTtsError(msg.includes("server error") ? "Server TTS error — cek koneksi" : "TTS gagal");
        setVoiceState("idle");
        setSpeakingId(null);
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
        return false;
      }
    };

    const handleBubbleTTS = async (msg: Message) => {
      if (speakingId === msg.id && voiceState === "playing") await stopTTS();
      else await playTTS(msg.content, msg.id);
    };

    // ── Clipboard ──────────────────────────────────────────────────────────────
    const copyMsg = async (msg: Message) => {
      await Clipboard.setStringAsync(msg.content);
      setCopiedId(msg.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => setCopiedId(null), 2000);
    };

    // ── Feedback ───────────────────────────────────────────────────────────────
    const sendFeedback = async (msg: Message, vote: Feedback) => {
      const cur = feedbackMap[msg.id];
      const next = cur === vote ? undefined : vote;
      setFeedbackMap(prev => {
        const n = { ...prev };
        if (next) n[msg.id] = next; else delete n[msg.id];
        return n;
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await fetch(apiRef.current.chatFeedback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msg_ts: Math.floor(msg.ts / 1000), content: msg.content, feedback: next ?? null }),
        });
      } catch {}
    };

    // ── addMessage ─────────────────────────────────────────────────────────────
    const addMessage = useCallback((role: "user" | "assistant", content: string): Message => {
      const msg: Message = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        role, content, ts: Date.now(),
      };
      setMessages(prev => [...prev, msg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return msg;
    }, []);

    // ── sendText — awaits TTS so the auto-loop can sequence correctly ──────────
    const sendText = async (text: string) => {
      if (!text.trim()) return;
      const inCall = isCallRef.current;
      if (!inCall) addMessage("user", text);
      setInputText("");
      try {
        const res = await fetch(apiRef.current.chat, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json();
        const reply = data.reply || "Tidak ada respons.";
        if (inCall) {
          await playTTS(reply);  // awaits full playback
        } else {
          const aMsg = addMessage("assistant", reply);
          if (ttsEnabledRef.current) await playTTS(reply, aMsg.id);
        }
      } catch {
        if (!inCall) addMessage("assistant", "Maaf, gagal terhubung ke TERRA.");
      }
    };

    // ── Recording ─────────────────────────────────────────────────────────────
    const startRecording = async (): Promise<boolean> => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== "granted") {
          addMessage("assistant", "Izin mikrofon diperlukan.");
          return false;
        }
        await setRecordingMode();
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        recordingRef.current = recording;
        setVoiceState("recording");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return true;
      } catch {
        setVoiceState("idle");
        return false;
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
        if (!uri) throw new Error("No URI");
        const form = new FormData();
        form.append("audio", { uri, name: "recording.m4a", type: "audio/m4a" } as unknown as Blob);
        form.append("lang", "id");
        const r = await fetch(apiRef.current.stt, { method: "POST", body: form });
        const d = await r.json();
        const transcript = d.text?.trim() ?? "";
        setCallTranscript(transcript);
        if (transcript) {
          await sendText(transcript);  // awaits full AI + TTS
        } else {
          setVoiceState("idle");
        }
      } catch {
        setVoiceState("idle");
      }
    };

    // Manual voice (chat mode only)
    const voiceButtonAction = () => {
      if (voiceState === "recording") stopRecordingAndSend();
      else if (voiceState === "idle") startRecording();
    };

    // ── AUTO VOICE LOOP ────────────────────────────────────────────────────────
    // [greet] → loop: [5s record] → [STT + AI + TTS] → [record again] ...
    const runAutoCallLoop = async () => {
      await playTTS("Halo! Saya TERRA, asisten inkubator Anda. Silakan bicara, saya dengarkan selama 5 detik.");

      while (autoCallRef.current) {
        const ok = await startRecording();
        if (!ok || !autoCallRef.current) break;

        // 5-second countdown
        countdownAnim.setValue(1);
        await new Promise<void>(resolve => {
          let secs = 5;
          setCallCountdown(secs);
          Animated.timing(countdownAnim, {
            toValue: 0,
            duration: 5000,
            easing: Easing.linear,
            useNativeDriver: false,
          }).start();

          const id = setInterval(() => {
            secs--;
            setCallCountdown(secs);
            if (secs <= 0) {
              clearInterval(id);
              callTimerRef.current = null;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              resolve();
            }
          }, 1000);
          callTimerRef.current = id;
        });

        countdownAnim.stopAnimation();
        setCallCountdown(0);

        if (!autoCallRef.current) {
          if (recordingRef.current) {
            try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
            recordingRef.current = null;
          }
          setVoiceState("idle");
          break;
        }

        await stopRecordingAndSend();

        if (autoCallRef.current) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      setVoiceState("idle");
      setCallCountdown(0);
    };

    // ── Toggle call mode ───────────────────────────────────────────────────────
    const toggleCall = async () => {
      if (isCallRef.current) {
        autoCallRef.current = false;
        isCallRef.current = false;
        if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
        countdownAnim.stopAnimation();
        countdownAnim.setValue(1);
        if (recordingRef.current) {
          try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
          recordingRef.current = null;
        }
        await stopTTS();
        setCallCountdown(0);
        setCallTranscript("");
        setIsCallMode(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Izin Mikrofon", "Izin mikrofon diperlukan untuk panggilan suara.");
          return;
        }
        isCallRef.current = true;
        autoCallRef.current = true;
        setIsCallMode(true);
        setCallTranscript("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        runAutoCallLoop().catch(console.error);
      }
    };

    useEffect(() => {
      return () => {
        autoCallRef.current = false;
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
        stopTTS().catch(() => {});
      };
    }, []);

    // ── Colors shorthand ───────────────────────────────────────────────────────
    const C    = colors;
    const A    = "#d97706";
    const A2   = "#f59e0b";
    const BG   = C.background;
    const SURF = C.card;
    const BD   = C.border;
    const TXT  = C.foreground;
    const TXT2 = C.mutedForeground;

    const sessions = React.useMemo(() => {
      const days: Record<string, Message> = {};
      messages.forEach(m => { const k = fmtDate(m.ts); if (!days[k]) days[k] = m; });
      return Object.entries(days).map(([date, m]) => ({ date, first: m })).reverse();
    }, [messages]);

    const callOrbColor = voiceState === "recording" ? "#EF4444"
      : voiceState === "playing"    ? A
      : voiceState === "processing" ? "#6366F1"
      : "#22C55E";
    const callOrbBg  = callOrbColor + "28";
    const callStatus = voiceState === "recording"
      ? (callCountdown > 0 ? `Mendengarkan... ${callCountdown}s` : "Mendengarkan...")
      : voiceState === "processing" ? "Memproses suara..."
      : voiceState === "playing"    ? "TERRA sedang menjawab..."
      : "Memulai...";

    // ─────────────────────────────────────────────────────────────────────────────
    return (
      <View style={[s.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={SURF} />

        {/* SIDEBAR */}
        {sidebarOpen && (
          <TouchableWithoutFeedback onPress={() => setSidebarOpen(false)}>
            <View style={s.overlay} />
          </TouchableWithoutFeedback>
        )}
        <Animated.View style={[s.sidebar, {
          backgroundColor: SURF, borderRightColor: BD,
          width: sbAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 260] }),
          opacity: sbAnim,
        }]}>
          <View style={[s.sbHead, { borderBottomColor: BD }]}>
            <View style={s.sbLogo}>
              <View style={[s.sbLogoIcon, { backgroundColor: A }]}>
                <Text style={s.sbLogoIconTxt}>T</Text>
              </View>
              <Text style={[s.sbLogoName, { color: TXT }]}>TERRA AI</Text>
            </View>
            <Pressable onPress={() => { setMessages([]); setSidebarOpen(false); }}
              style={[s.sbNewBtn, { backgroundColor: C.muted, borderColor: BD }]}>
              <Feather name="plus" size={13} color={TXT2} />
              <Text style={[s.sbNewTxt, { color: TXT2 }]}>Chat baru</Text>
            </Pressable>
          </View>
          <ScrollView style={s.sbList} showsVerticalScrollIndicator={false}>
            <Text style={[s.sbLabel, { color: TXT2 }]}>RIWAYAT</Text>
            {sessions.length === 0
              ? <Text style={[s.sbEmpty, { color: TXT2 }]}>Belum ada riwayat</Text>
              : sessions.map(({ date, first }) => (
                <Pressable key={date} style={({ pressed }) => [s.sbItem, { backgroundColor: pressed ? C.muted : "transparent" }]}>
                  <Feather name="message-square" size={12} color={TXT2} style={{ marginRight: 7 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.sbItemTitle, { color: TXT }]} numberOfLines={1}>
                      {first.role === "user" ? first.content.slice(0, 38) : "TERRA: " + first.content.slice(0, 30)}
                    </Text>
                    <Text style={[s.sbItemMeta, { color: TXT2 }]}>{date}</Text>
                  </View>
                </Pressable>
              ))
            }
          </ScrollView>
          <View style={[s.sbFoot, { borderTopColor: BD }]}>
            <Pressable onPress={deleteHistory} style={s.sbFootBtn}>
              <Feather name="trash-2" size={13} color={TXT2} />
              <Text style={[s.sbFootTxt, { color: TXT2 }]}>Hapus semua</Text>
            </Pressable>
            <Pressable onPress={loadHistory} style={s.sbFootBtn}>
              <Feather name="refresh-cw" size={13} color={TXT2} />
              <Text style={[s.sbFootTxt, { color: TXT2 }]}>Refresh</Text>
            </Pressable>
          </View>
        </Animated.View>

        {/* MAIN */}
        <View style={s.main}>

          {/* HEADER */}
          <View style={[s.header, { paddingTop: topPad + 8, backgroundColor: SURF, borderBottomColor: BD }]}>
            <Pressable onPress={() => setSidebarOpen(v => !v)} style={s.hdrBtn}>
              <Feather name={sidebarOpen ? "x" : "menu"} size={18} color={TXT2} />
            </Pressable>
            <View style={[s.hdrPill, { backgroundColor: C.muted, borderColor: BD }]}>
              <View style={[s.hdrDot, { backgroundColor: A }]} />
              <Text style={[s.hdrPillTxt, { color: TXT }]}>TERRA</Text>
              <Text style={[s.hdrPillSub, { color: TXT2 }]}>AI Inkubator</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => { setTtsEnabled(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[s.hdrBtn, ttsEnabled && { backgroundColor: A + "22", borderRadius: 8, borderWidth: 1, borderColor: A }]}>
              <Feather name={ttsEnabled ? "volume-2" : "volume-x"} size={17} color={ttsEnabled ? A2 : TXT2} />
            </Pressable>
            <Pressable onPress={loadHistory} disabled={isLoadingHist} style={s.hdrBtn}>
              <Feather name="refresh-cw" size={16} color={isLoadingHist ? A : TXT2} />
            </Pressable>
            {messages.length > 0 && (
              <Pressable onPress={deleteHistory} style={s.hdrBtn}>
                <Feather name="trash-2" size={16} color={C.destructive} />
              </Pressable>
            )}
            <Pressable onPress={toggleCall} style={[s.hdrCallPill, {
              backgroundColor: isCallMode ? "#EF444418" : SURF,
              borderColor: isCallMode ? "#EF4444" : BD,
            }]}>
              <Feather name={isCallMode ? "phone-off" : "phone"} size={16} color={isCallMode ? "#EF4444" : TXT2} />
              <Text style={[s.hdrCallTxt, { color: isCallMode ? "#EF4444" : TXT2 }]}>
                {isCallMode ? "Tutup" : "Panggil"}
              </Text>
            </Pressable>
          </View>

          {/* TTS ERROR */}
          {ttsError && (
            <Pressable onPress={() => setTtsError(null)}
              style={[s.errBanner, { backgroundColor: C.destructive + "22", borderColor: C.destructive + "55" }]}>
              <Feather name="alert-circle" size={14} color={C.destructive} />
              <Text style={[s.errTxt, { color: C.destructive }]}>{ttsError}</Text>
              <Feather name="x" size={14} color={C.destructive} />
            </Pressable>
          )}

          {/* ══ CALL SCREEN — full-screen phone call UI ═══════════════════════ */}
          {isCallMode && (
            <View style={[s.callScreen, { backgroundColor: BG }]}>

              {/* Top badge */}
              <View style={s.callTopRow}>
                <View style={[s.callBadge, { backgroundColor: "#EF444418", borderColor: "#EF444440" }]}>
                  <View style={[s.callBadgeDot, { backgroundColor: "#EF4444" }]} />
                  <Text style={[s.callBadgeTxt, { color: "#EF4444" }]}>PANGGILAN AKTIF</Text>
                </View>
              </View>

              {/* Center: orb */}
              <View style={s.callCenter}>
                {/* Outer glow ring when recording */}
                {voiceState === "recording" && (
                  <Animated.View style={[s.callGlow, {
                    borderColor: callOrbColor + "40",
                    transform: [{ scale: pulseAnim.interpolate({ inputRange: [1, 1.22], outputRange: [1.45, 1.65] }) }],
                  }]} />
                )}

                {/* Main orb */}
                <Animated.View style={[s.callOrb, {
                  backgroundColor: callOrbBg,
                  borderColor: callOrbColor,
                  transform: [{ scale: pulseAnim }],
                }]}>
                  <Text style={[s.callOrbLetter, { color: callOrbColor }]}>T</Text>
                </Animated.View>

                <Text style={[s.callName, { color: TXT }]}>TERRA</Text>
                <Text style={[s.callStatusTxt, { color: TXT2 }]}>{callStatus}</Text>

                {/* Countdown progress bar */}
                {voiceState === "recording" && (
                  <View style={[s.cdTrack, { backgroundColor: BD }]}>
                    <Animated.View style={[s.cdFill, {
                      backgroundColor: callOrbColor,
                      width: countdownAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                    }]} />
                  </View>
                )}

                {/* Transcript bubble */}
                {!!callTranscript && (
                  <View style={[s.transcriptBox, { backgroundColor: SURF, borderColor: BD }]}>
                    <Text style={[s.transcriptLbl, { color: TXT2 }]}>Anda:</Text>
                    <Text style={[s.transcriptTxt, { color: TXT }]} numberOfLines={3}>{callTranscript}</Text>
                  </View>
                )}
              </View>

              {/* Bottom: hint + red end-call button */}
              <View style={s.callBottom}>
                <Text style={[s.callHint, { color: TXT2 }]}>
                  {voiceState === "recording"
                    ? "Bicara bebas — otomatis berhenti tiap 5 detik"
                    : voiceState === "processing" || voiceState === "playing"
                      ? "Tunggu giliran Anda..."
                      : "Menyiapkan..."}
                </Text>
                <Pressable onPress={toggleCall} style={({ pressed }) => [s.endBtn, { opacity: pressed ? 0.8 : 1 }]}>
                  <Feather name="phone-off" size={30} color="#fff" />
                </Pressable>
                <Text style={[s.endBtnLbl, { color: TXT2 }]}>Akhiri Panggilan</Text>
              </View>
            </View>
          )}

          {/* ══ CHAT MODE ═════════════════════════════════════════════════════ */}
          {!isCallMode && (
            <>
              <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}
                contentContainerStyle={[s.chatList, { paddingBottom: 16 }]}>
                {isLoadingHist && (
                  <View style={s.loadRow}>
                    <ActivityIndicator size="small" color={A} />
                    <Text style={[s.loadTxt, { color: TXT2 }]}>Memuat riwayat...</Text>
                  </View>
                )}
                {!isLoadingHist && messages.length === 0 && (
                  <View style={s.empty}>
                    <View style={[s.emptyIcon, { backgroundColor: A + "22" }]}>
                      <Text style={{ fontSize: 32 }}>🌡️</Text>
                    </View>
                    <Text style={[s.emptyTitle, { color: TXT }]}>Tanya TERRA</Text>
                    <Text style={[s.emptyDesc, { color: TXT2 }]}>
                      Tanya kondisi mesin, minta kontrol perangkat, atau buat sesi inkubasi baru.
                    </Text>
                    {["Suhu mesin sekarang berapa?", "Nyalakan heater", "Buat sesi inkubasi ayam 100 telur"].map(q => (
                      <Pressable key={q} onPress={() => sendText(q)}
                        style={({ pressed }) => [s.chip, { backgroundColor: SURF, borderColor: BD, opacity: pressed ? 0.8 : 1 }]}>
                        <Text style={[s.chipTxt, { color: TXT }]}>{q}</Text>
                        <Feather name="arrow-right" size={13} color={TXT2} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {messages.map(msg => (
                  <View key={msg.id} style={msg.role === "user" ? s.wrapUser : s.wrapBot}>
                    <View style={[
                      s.bubble,
                      msg.role === "user"
                        ? [s.bubbleUser, { backgroundColor: C.primary }]
                        : [s.bubbleBot, { backgroundColor: SURF, borderColor: BD }],
                    ]}>
                      {msg.role === "assistant" && (
                        <Text style={[s.botName, { color: A2 }]}>TERRA</Text>
                      )}
                      <Text style={[s.bubbleTxt, { color: msg.role === "user" ? "#fff" : TXT }]}>
                        {msg.content}
                      </Text>
                      {msg.role === "assistant" ? (
                        <View style={[s.bubFoot, { borderTopColor: BD + "55" }]}>
                          <Pressable onPress={() => handleBubbleTTS(msg)}
                            disabled={voiceState === "processing" || voiceState === "recording"}
                            style={({ pressed }) => [s.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                            <Feather
                              name={speakingId === msg.id && voiceState === "playing" ? "volume-x" : "volume-2"}
                              size={14} color={speakingId === msg.id ? A2 : TXT2} />
                          </Pressable>
                          <Pressable onPress={() => copyMsg(msg)}
                            style={({ pressed }) => [s.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                            <Feather name={copiedId === msg.id ? "check" : "copy"} size={14}
                              color={copiedId === msg.id ? C.primary : TXT2} />
                          </Pressable>
                          <Pressable onPress={() => sendFeedback(msg, "up")}
                            style={({ pressed }) => [s.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                            <Feather name="thumbs-up" size={14}
                              color={feedbackMap[msg.id] === "up" ? C.primary : TXT2} />
                          </Pressable>
                          <Pressable onPress={() => sendFeedback(msg, "down")}
                            style={({ pressed }) => [s.footBtn, { opacity: pressed ? 0.6 : 1 }]}>
                            <Feather name="thumbs-down" size={14}
                              color={feedbackMap[msg.id] === "down" ? C.destructive : TXT2} />
                          </Pressable>
                          <View style={{ flex: 1 }} />
                          <Text style={[s.footTime, { color: TXT2 }]}>{fmtTime(msg.ts)}</Text>
                        </View>
                      ) : (
                        <Text style={[s.userTime, { color: "rgba(255,255,255,0.5)" }]}>
                          {fmtDate(msg.ts)} {fmtTime(msg.ts)}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* INPUT BAR */}
              <View style={[s.inputBar, {
                backgroundColor: SURF, borderTopColor: BD,
                paddingBottom: Math.max(insets.bottom, 10),
                marginBottom: tabBarH,
              }]}>
                <Pressable onPress={voiceButtonAction} disabled={voiceState === "processing"}
                  style={[s.circleBtn, {
                    backgroundColor: voiceState === "recording" ? C.destructive + "22" : C.muted,
                    borderColor: voiceState === "recording" ? C.destructive : BD,
                  }]}>
                  <Feather name={voiceState === "recording" ? "square" : "mic"} size={18}
                    color={voiceState === "recording" ? C.destructive : TXT2} />
                </Pressable>
                <TextInput
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Ketik pesan ke TERRA..."
                  placeholderTextColor={TXT2}
                  style={[s.textInput, { backgroundColor: C.muted, color: TXT }]}
                  onSubmitEditing={() => sendText(inputText)}
                  returnKeyType="send"
                  multiline
                />
                <Pressable onPress={() => sendText(inputText)} disabled={!inputText.trim()}
                  style={({ pressed }) => [s.sendBtn, {
                    backgroundColor: inputText.trim() ? A : C.muted,
                    opacity: pressed ? 0.8 : 1,
                  }]}>
                  <Feather name="send" size={17} color={inputText.trim() ? "#fff" : TXT2} />
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    );
  }

  // ─── Styles ───────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    root:    { flex: 1, flexDirection: "row" },
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: "rgba(0,0,0,0.45)" },

    // Sidebar
    sidebar:      { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 20, borderRightWidth: 1, overflow: "hidden" },
    sbHead:       { padding: 14, borderBottomWidth: 1 },
    sbLogo:       { flexDirection: "row", alignItems: "center", marginBottom: 10 },
    sbLogoIcon:   { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", marginRight: 8 },
    sbLogoIconTxt:{ color: "#fff", fontSize: 14, fontWeight: "700" },
    sbLogoName:   { fontSize: 15, fontWeight: "700" },
    sbNewBtn:     { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
    sbNewTxt:     { fontSize: 12, marginLeft: 6 },
    sbList:       { flex: 1, paddingHorizontal: 8, paddingTop: 4 },
    sbLabel:      { fontSize: 10, fontWeight: "600", letterSpacing: 0.8, paddingHorizontal: 4, paddingVertical: 6 },
    sbEmpty:      { fontSize: 13, textAlign: "center", marginTop: 16, lineHeight: 20 },
    sbItem:       { flexDirection: "row", alignItems: "center", padding: 8, borderRadius: 8, marginBottom: 2 },
    sbItemTitle:  { fontSize: 12, fontWeight: "500" },
    sbItemMeta:   { fontSize: 10, marginTop: 1 },
    sbFoot:       { flexDirection: "row", padding: 10, borderTopWidth: 1, gap: 4 },
    sbFootBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 7, borderRadius: 6 },
    sbFootTxt:    { fontSize: 12, marginLeft: 5 },

    // Main
    main: { flex: 1 },

    // Header
    header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: 1, gap: 4 },
    hdrBtn:      { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    hdrPill:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
    hdrDot:      { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
    hdrPillTxt:  { fontSize: 14, fontWeight: "700", marginRight: 4 },
    hdrPillSub:  { fontSize: 11 },
    hdrCallPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
    hdrCallTxt:  { fontSize: 12, fontWeight: "600", marginLeft: 4 },

    errBanner: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, gap: 8 },
    errTxt:    { flex: 1, fontSize: 12 },

    // ── Call screen
    callScreen:  { flex: 1, flexDirection: "column" },
    callTopRow:  { paddingTop: 20, paddingHorizontal: 20, alignItems: "center" },
    callBadge:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
    callBadgeDot:{ width: 7, height: 7, borderRadius: 4, marginRight: 8 },
    callBadgeTxt:{ fontSize: 12, fontWeight: "700", letterSpacing: 1 },

    callCenter:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 32 },
    callGlow:    { position: "absolute", width: 148, height: 148, borderRadius: 74, borderWidth: 2 },
    callOrb:     { width: 128, height: 128, borderRadius: 64, alignItems: "center", justifyContent: "center", borderWidth: 2.5 },
    callOrbLetter:{ fontSize: 54, fontWeight: "800" },
    callName:    { fontSize: 28, fontWeight: "700" },
    callStatusTxt:{ fontSize: 15, fontWeight: "500" },

    cdTrack: { width: "78%", height: 5, borderRadius: 3, overflow: "hidden", marginTop: 2 },
    cdFill:  { height: 5, borderRadius: 3 },

    transcriptBox: { width: "100%", padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 4 },
    transcriptLbl: { fontSize: 11, fontWeight: "600", marginBottom: 4 },
    transcriptTxt: { fontSize: 14, lineHeight: 22 },

    callBottom: { alignItems: "center", paddingBottom: 52, gap: 10 },
    callHint:   { fontSize: 13, textAlign: "center", paddingHorizontal: 32 },
    endBtn:     { width: 72, height: 72, borderRadius: 36, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" },
    endBtnLbl:  { fontSize: 12 },

    // Chat
    chatList:  { padding: 16, flexGrow: 1, gap: 8 },
    loadRow:   { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 24, gap: 8 },
    loadTxt:   { fontSize: 13 },
    empty:     { flex: 1, alignItems: "center", paddingTop: 40, gap: 12 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
    emptyTitle:{ fontSize: 18, fontWeight: "700" },
    emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 },
    chip:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", padding: 12, borderRadius: 8, borderWidth: 1, gap: 8 },
    chipTxt:   { fontSize: 14, flex: 1 },

    wrapUser:  { alignItems: "flex-end" },
    wrapBot:   { alignItems: "flex-start" },
    bubble:    { maxWidth: "86%", borderRadius: 14, overflow: "hidden" },
    bubbleUser:{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
    bubbleBot: { borderWidth: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 0 },
    botName:   { fontSize: 11, fontWeight: "700", marginBottom: 3 },
    bubbleTxt: { fontSize: 14, lineHeight: 21 },
    bubFoot:   { flexDirection: "row", alignItems: "center", marginTop: 8, paddingTop: 6, paddingBottom: 7, borderTopWidth: 1 },
    footBtn:   { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5 },
    footTime:  { fontSize: 11 },
    userTime:  { fontSize: 10, marginTop: 4, textAlign: "right", paddingBottom: 8 },

    inputBar:  { flexDirection: "row", alignItems: "flex-end", padding: 10, borderTopWidth: 1, gap: 6 },
    circleBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    textInput: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 14, maxHeight: 100 },
    sendBtn:   { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  });
  