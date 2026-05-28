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
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

// Audio mode set once globally
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
  _audioModeReady = false; // force re-init after recording
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
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { serverUrl } = useIncubator();
  const apiRef = useRef(buildApi(serverUrl));
  useEffect(() => { apiRef.current = buildApi(serverUrl); }, [serverUrl]);

  // ── State
  const [messages,         setMessages]         = useState<Message[]>([]);
  const [inputText,        setInputText]        = useState("");
  const [voiceState,       setVoiceState]       = useState<VoiceState>("idle");
  const [isCallMode,       setIsCallMode]       = useState(false);
  const [callTranscript,   setCallTranscript]   = useState("");
  const [isLoadingHist,    setIsLoadingHist]    = useState(true);
  const [ttsEnabled,       setTtsEnabled]       = useState(false);
  const [speakingId,       setSpeakingId]       = useState<string|null>(null);
  const [copiedId,         setCopiedId]         = useState<string|null>(null);
  const [feedbackMap,      setFeedbackMap]      = useState<Record<string,Feedback>>({});
  const [sidebarOpen,      setSidebarOpen]      = useState(false);
  const [ttsError,         setTtsError]         = useState<string|null>(null);

  // refs — accessible from async/closure without stale value
  const ttsEnabledRef   = useRef(false);
  const isCallRef        = useRef(false);
  const recordingRef     = useRef<Audio.Recording|null>(null);
  const soundRef         = useRef<Audio.Sound|null>(null);
  const scrollRef        = useRef<ScrollView>(null);
  const pulseAnim        = useRef(new Animated.Value(1)).current;
  const sbAnim           = useRef(new Animated.Value(0)).current;

  const topPad  = Platform.OS === "web" ? 67 : insets.top;
  const tabBarH = Platform.OS === "ios"
    ? 49 + insets.bottom
    : 50 + Math.max(insets.bottom + 12, 40);

  // ── Sync refs
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);
  useEffect(() => { isCallRef.current = isCallMode; }, [isCallMode]);

  // ── Restore TTS pref
  useEffect(() => {
    AsyncStorage.getItem("terra_tts_autoplay").then(v => {
      const on = v === "1";
      setTtsEnabled(on);
      ttsEnabledRef.current = on;
    }).catch(()=>{});
    setPlaybackMode().catch(()=>{});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem("terra_tts_autoplay", ttsEnabled ? "1" : "0").catch(()=>{});
  }, [ttsEnabled]);

  // ── Sidebar anim
  useEffect(() => {
    Animated.timing(sbAnim, {
      toValue: sidebarOpen ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [sidebarOpen]);

  // ── Pulse anim for recording
  useEffect(() => {
    if (voiceState === "recording") {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim,{toValue:1.3,duration:600,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),
        Animated.timing(pulseAnim,{toValue:1,  duration:600,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),
      ])).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [voiceState]);

  // ── History
  const loadHistory = useCallback(async () => {
    setIsLoadingHist(true);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 8000);
      const res = await fetch(apiRef.current.chatHistory(100), { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP "+res.status);
      const data: Array<{ts:number; role:string; content:string}> = await res.json();
      const msgs: Message[] = data.reverse().map((r,i)=>({
        id: `h_${r.ts}_${i}`,
        role: r.role as "user"|"assistant",
        content: r.content,
        ts: r.ts * 1000,
      }));
      setMessages(msgs);
      setTimeout(()=>scrollRef.current?.scrollToEnd({animated:false}), 150);
    } catch { /* offline */ }
    finally { setIsLoadingHist(false); }
  }, [serverUrl]);

  useEffect(()=>{ loadHistory(); },[loadHistory]);

  const deleteHistory = () => {
    Alert.alert("Hapus Riwayat Chat","Semua percakapan akan dihapus permanen. Lanjutkan?",[
      {text:"Batal", style:"cancel"},
      {text:"Hapus", style:"destructive", onPress: async ()=>{
        try {
          const res = await fetch(apiRef.current.chatClear, {method:"POST"});
          if (!res.ok) throw new Error();
          setMessages([]);
          setFeedbackMap({});
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch { Alert.alert("Gagal","Tidak dapat menghapus riwayat."); }
      }},
    ]);
  };

  // ── TTS
  const stopTTS = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync().catch(()=>{});
        await soundRef.current.unloadAsync().catch(()=>{});
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
      const timer = setTimeout(()=>ctrl.abort(), 25000);
      const res = await fetch(apiRef.current.tts, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({text, voice:"id-ID-GadisNeural"}),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(()=>"");
        throw new Error(`TTS server error ${res.status}: ${errBody.slice(0,120)}`);
      }

      const ab = await res.arrayBuffer();
      if (!ab || ab.byteLength < 50) throw new Error("TTS: audio response kosong");

      const bytes = new Uint8Array(ab);
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+CHUNK, bytes.length)));
      }
      await FileSystem.writeAsStringAsync(localUri, btoa(binary), {
        encoding: FileSystem.EncodingType.Base64,
      });

      const {sound} = await Audio.Sound.createAsync(
        {uri: localUri},
        {shouldPlay: false}
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(s => {
        if (s.isLoaded && s.didJustFinish) {
          setVoiceState("idle");
          setSpeakingId(null);
          soundRef.current = null;
          FileSystem.deleteAsync(localUri, {idempotent:true}).catch(()=>{});
        }
      });
      await sound.playAsync();
      return true;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("TTS error:", msg);
      setTtsError(msg.includes("server error") ? "Server TTS error — cek koneksi" : "TTS gagal");
      setVoiceState("idle");
      setSpeakingId(null);
      FileSystem.deleteAsync(localUri, {idempotent:true}).catch(()=>{});
      return false;
    }
  };

  const handleBubbleTTS = async (msg: Message) => {
    if (speakingId === msg.id && voiceState === "playing") await stopTTS();
    else await playTTS(msg.content, msg.id);
  };

  // ── Clipboard
  const copyMsg = async (msg: Message) => {
    await Clipboard.setStringAsync(msg.content);
    setCopiedId(msg.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(()=>setCopiedId(null), 2000);
  };

  // ── Feedback
  const sendFeedback = async (msg: Message, vote: Feedback) => {
    const cur = feedbackMap[msg.id];
    const next = cur === vote ? undefined : vote;
    setFeedbackMap(prev=>{ const n={...prev}; if(next) n[msg.id]=next; else delete n[msg.id]; return n; });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await fetch(apiRef.current.chatFeedback,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({msg_ts: Math.floor(msg.ts/1000), content: msg.content, feedback: next??null}),
      });
    } catch {}
  };

  // ── addMessage (does NOT modify isCallRef — avoids stale closure)
  const addMessage = useCallback((role:"user"|"assistant", content:string): Message => {
    const msg: Message = {
      id: Date.now().toString()+Math.random().toString(36).slice(2),
      role, content, ts: Date.now(),
    };
    setMessages(prev=>[...prev, msg]);
    setTimeout(()=>scrollRef.current?.scrollToEnd({animated:true}), 100);
    return msg;
  }, []);

  // ── sendText — use ref snapshot to decide call vs chat mode
  const sendText = async (text: string) => {
    if (!text.trim()) return;
    const inCall = isCallRef.current;      // snapshot BEFORE any setState
    if (!inCall) addMessage("user", text);
    setInputText("");

    try {
      const res = await fetch(apiRef.current.chat,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({message: text}),
      });
      const data = await res.json();
      const reply = data.reply || "Tidak ada respons.";

      if (inCall) {
        // call mode: only voice, no chat bubbles
        await playTTS(reply);
      } else {
        const aMsg = addMessage("assistant", reply);
        if (ttsEnabledRef.current) await playTTS(reply, aMsg.id);
      }
    } catch {
      if (!inCall) addMessage("assistant","Maaf, gagal terhubung ke TERRA.");
    }
  };

  // ── Voice recording
  const startRecording = async () => {
    try {
      const {status} = await Audio.requestPermissionsAsync();
      if (status !== "granted") { addMessage("assistant","Izin mikrofon diperlukan."); return; }
      await setRecordingMode();
      const {recording} = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
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
      form.append("audio",{uri, name:"recording.m4a", type:"audio/m4a"} as unknown as Blob);
      form.append("lang","id");
      const r = await fetch(apiRef.current.stt,{method:"POST",body:form});
      const d = await r.json();
      const transcript = d.text || "";
      setCallTranscript(transcript);
      if (transcript) await sendText(transcript);
      else setVoiceState("idle");
    } catch { setVoiceState("idle"); }
  };

  const voiceButtonAction = () => {
    if (voiceState === "recording") stopRecordingAndSend();
    else if (voiceState === "idle") startRecording();
  };

  // ── Toggle call mode — STOP any ongoing TTS first
  const toggleCall = async () => {
    await stopTTS();
    setIsCallMode(v => {
      const next = !v;
      isCallRef.current = next;   // sync ref immediately
      if (next) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // addMessage inside setTimeout so isCallRef is already false->"true" when checked
        setTimeout(()=>{
          addMessage("assistant","Halo! Saya TERRA. Tekan tombol mikrofon untuk berbicara.");
        }, 0);
      } else {
        setCallTranscript("");
      }
      return next;
    });
  };

  // ── Colors shorthand
  const C = colors;
  const A  = "#d97706";   // amber accent
  const A2 = "#f59e0b";
  const BG = C.background;
  const SURF = C.card;
  const BD = C.border;
  const TXT = C.foreground;
  const TXT2 = C.mutedForeground;

  // ── Sidebar sessions derived from messages
  const sessions = React.useMemo(() => {
    const days: Record<string, Message> = {};
    messages.forEach(m => {
      const key = fmtDate(m.ts);
      if (!days[key]) days[key] = m;
    });
    return Object.entries(days).map(([date, m]) => ({date, first: m})).reverse();
  }, [messages]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root,{backgroundColor:BG}]}>
      <StatusBar barStyle="light-content" backgroundColor={SURF} />

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════════ */}
      {sidebarOpen && (
        <TouchableWithoutFeedback onPress={()=>setSidebarOpen(false)}>
          <View style={s.overlay}/>
        </TouchableWithoutFeedback>
      )}

      <Animated.View style={[s.sidebar,{
        backgroundColor: SURF,
        borderRightColor: BD,
        width: sbAnim.interpolate({inputRange:[0,1],outputRange:[0,260]}),
        opacity: sbAnim,
      }]}>
        {/* Sidebar head */}
        <View style={[s.sbHead,{borderBottomColor:BD}]}>
          {/* Logo */}
          <View style={s.sbLogo}>
            <View style={[s.sbLogoIcon,{backgroundColor:A}]}>
              <Text style={s.sbLogoIconTxt}>T</Text>
            </View>
            <Text style={[s.sbLogoName,{color:TXT}]}>TERRA AI</Text>
          </View>
          {/* New chat */}
          <Pressable onPress={()=>{setMessages([]);setSidebarOpen(false);}}
            style={[s.sbNewBtn,{backgroundColor:C.muted,borderColor:BD}]}>
            <Feather name="plus" size={13} color={TXT2}/>
            <Text style={[s.sbNewTxt,{color:TXT2}]}>Chat baru</Text>
          </Pressable>
        </View>

        {/* Session list */}
        <ScrollView style={s.sbList} showsVerticalScrollIndicator={false}>
          <Text style={[s.sbLabel,{color:TXT2}]}>RIWAYAT</Text>
          {sessions.length === 0
            ? <Text style={[s.sbEmpty,{color:TXT2}]}>Belum ada riwayat</Text>
            : sessions.map(({date, first})=>(
                <Pressable key={date}
                  style={({pressed})=>[s.sbItem,{backgroundColor:pressed?C.muted:"transparent"}]}>
                  <Feather name="message-square" size={12} color={TXT2} style={{marginRight:7}}/>
                  <View style={{flex:1}}>
                    <Text style={[s.sbItemTitle,{color:TXT}]} numberOfLines={1}>
                      {first.role==="user" ? first.content.slice(0,38) : "TERRA: "+first.content.slice(0,30)}
                    </Text>
                    <Text style={[s.sbItemMeta,{color:TXT2}]}>{date}</Text>
                  </View>
                </Pressable>
              ))
          }
        </ScrollView>

        {/* Sidebar footer */}
        <View style={[s.sbFoot,{borderTopColor:BD}]}>
          <Pressable onPress={deleteHistory} style={s.sbFootBtn}>
            <Feather name="trash-2" size={13} color={TXT2}/>
            <Text style={[s.sbFootTxt,{color:TXT2}]}>Hapus semua</Text>
          </Pressable>
          <Pressable onPress={loadHistory} style={s.sbFootBtn}>
            <Feather name="refresh-cw" size={13} color={TXT2}/>
            <Text style={[s.sbFootTxt,{color:TXT2}]}>Refresh</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <View style={s.main}>

        {/* ── HEADER ── */}
        <View style={[s.header,{
          paddingTop: topPad+8,
          backgroundColor: SURF,
          borderBottomColor: BD,
        }]}>
          {/* Sidebar toggle */}
          <Pressable onPress={()=>setSidebarOpen(v=>!v)} style={s.hdrBtn}>
            <Feather name={sidebarOpen?"x":"menu"} size={18} color={TXT2}/>
          </Pressable>

          {/* Model pill */}
          <View style={[s.hdrPill,{backgroundColor:C.muted,borderColor:BD}]}>
            <View style={[s.hdrDot,{backgroundColor:A}]}/>
            <Text style={[s.hdrPillTxt,{color:TXT}]}>TERRA</Text>
            <Text style={[s.hdrPillSub,{color:TXT2}]}>AI Inkubator</Text>
          </View>

          <View style={{flex:1}}/>

          {/* TTS toggle */}
          <Pressable
            onPress={()=>{setTtsEnabled(v=>!v);Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);}}
            style={[s.hdrBtn,ttsEnabled&&{backgroundColor:A+"22",borderRadius:8,borderWidth:1,borderColor:A}]}>
            <Feather name={ttsEnabled?"volume-2":"volume-x"} size={17}
              color={ttsEnabled?A2:TXT2}/>
          </Pressable>

          {/* Refresh */}
          <Pressable onPress={loadHistory} disabled={isLoadingHist} style={s.hdrBtn}>
            <Feather name="refresh-cw" size={16} color={isLoadingHist?A:TXT2}/>
          </Pressable>

          {/* Delete */}
          {messages.length>0 && (
            <Pressable onPress={deleteHistory} style={s.hdrBtn}>
              <Feather name="trash-2" size={16} color={C.destructive}/>
            </Pressable>
          )}

          {/* Voice call */}
          <Pressable onPress={toggleCall}
            style={[s.hdrCallPill,{
              backgroundColor: isCallMode ? A+"22" : SURF,
              borderColor: isCallMode ? A : BD,
            }]}>
            <Feather name={isCallMode?"phone-off":"phone"} size={16}
              color={isCallMode?A2:TXT2}/>
            <Text style={[s.hdrCallTxt,{color:isCallMode?A2:TXT2}]}>
              {isCallMode?"Akhiri":"Voice"}
            </Text>
          </Pressable>
        </View>

        {/* ── TTS ERROR BANNER ── */}
        {ttsError && (
          <Pressable onPress={()=>setTtsError(null)}
            style={[s.errBanner,{backgroundColor:C.destructive+"22",borderColor:C.destructive+"55"}]}>
            <Feather name="alert-circle" size={14} color={C.destructive}/>
            <Text style={[s.errTxt,{color:C.destructive}]}>{ttsError}</Text>
            <Feather name="x" size={14} color={C.destructive}/>
          </Pressable>
        )}

        {/* ── CALL BANNER ── */}
        {isCallMode && (
          <LinearGradient colors={[SURF,BG]} style={s.callBanner}>
            <Animated.View style={[s.callAvatar,{
              backgroundColor: voiceState==="recording" ? C.destructive+"22"
                : voiceState==="playing" ? A+"22" : C.primary+"22",
              borderColor: voiceState==="recording" ? C.destructive
                : voiceState==="playing" ? A : C.primary,
              transform:[{scale:pulseAnim}],
            }]}>
              <Text style={s.callAvatarTxt}>T</Text>
            </Animated.View>

            <Text style={[s.callStatus,{color:TXT}]}>
              {voiceState==="recording" ? "Mendengarkan..."
                : voiceState==="processing" ? "Memproses..."
                : voiceState==="playing"   ? "TERRA berbicara..."
                : "TERRA siap"}
            </Text>

            {!!callTranscript && (
              <Text style={[s.callTranscript,{color:TXT2}]} numberOfLines={2}>
                "{callTranscript}"
              </Text>
            )}

            <Pressable onPress={voiceButtonAction}
              disabled={voiceState==="processing"||voiceState==="playing"}
              style={({pressed})=>[s.voiceBtn,{
                backgroundColor: voiceState==="recording" ? C.destructive : A,
                opacity: (voiceState==="processing"||voiceState==="playing") ? 0.5 : pressed ? 0.8 : 1,
              }]}>
              <Feather name={voiceState==="recording"?"square":"mic"} size={28} color="#fff"/>
            </Pressable>

            <Text style={[s.voiceHint,{color:TXT2}]}>
              {voiceState==="recording"?"Tap untuk berhenti":"Tap untuk bicara"}
            </Text>
          </LinearGradient>
        )}

        {/* ── CHAT LIST ── */}
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.chatList,{paddingBottom:16}]}>

          {isLoadingHist && (
            <View style={s.loadRow}>
              <ActivityIndicator size="small" color={A}/>
              <Text style={[s.loadTxt,{color:TXT2}]}>Memuat riwayat...</Text>
            </View>
          )}

          {!isLoadingHist && messages.length===0 && (
            <View style={s.empty}>
              <View style={[s.emptyIcon,{backgroundColor:A+"22"}]}>
                <Text style={{fontSize:32}}>🌡️</Text>
              </View>
              <Text style={[s.emptyTitle,{color:TXT}]}>Tanya TERRA</Text>
              <Text style={[s.emptyDesc,{color:TXT2}]}>
                Tanya kondisi mesin, minta kontrol perangkat, atau buat sesi inkubasi baru.
              </Text>
              {["Suhu mesin sekarang berapa?","Nyalakan heater","Buat sesi inkubasi ayam 100 telur"].map(q=>(
                <Pressable key={q} onPress={()=>sendText(q)}
                  style={({pressed})=>[s.chip,{backgroundColor:SURF,borderColor:BD,opacity:pressed?.8:1}]}>
                  <Text style={[s.chipTxt,{color:TXT}]}>{q}</Text>
                  <Feather name="arrow-right" size={13} color={TXT2}/>
                </Pressable>
              ))}
            </View>
          )}

          {messages.map(msg => (
            <View key={msg.id} style={msg.role==="user" ? s.wrapUser : s.wrapBot}>
              <View style={[
                s.bubble,
                msg.role==="user"
                  ? [s.bubbleUser,{backgroundColor:C.primary}]
                  : [s.bubbleBot, {backgroundColor:SURF, borderColor:BD}],
              ]}>
                {msg.role==="assistant" && (
                  <Text style={[s.botName,{color:A2}]}>TERRA</Text>
                )}
                <Text style={[s.bubbleTxt,{color:msg.role==="user"?"#fff":TXT}]}>
                  {msg.content}
                </Text>

                {msg.role==="assistant" ? (
                  <View style={[s.bubFoot,{borderTopColor:BD+"55"}]}>
                    {/* TTS */}
                    <Pressable onPress={()=>handleBubbleTTS(msg)}
                      disabled={voiceState==="processing"||voiceState==="recording"}
                      style={({pressed})=>[s.footBtn,{opacity:pressed?.6:1}]}>
                      <Feather
                        name={speakingId===msg.id&&voiceState==="playing"?"volume-x":"volume-2"}
                        size={14}
                        color={speakingId===msg.id ? A2 : TXT2}
                      />
                    </Pressable>
                    {/* Copy */}
                    <Pressable onPress={()=>copyMsg(msg)}
                      style={({pressed})=>[s.footBtn,{opacity:pressed?.6:1}]}>
                      <Feather name={copiedId===msg.id?"check":"copy"} size={14}
                        color={copiedId===msg.id ? C.primary : TXT2}/>
                    </Pressable>
                    {/* Thumbs up */}
                    <Pressable onPress={()=>sendFeedback(msg,"up")}
                      style={({pressed})=>[s.footBtn,{opacity:pressed?.6:1}]}>
                      <Feather name="thumbs-up" size={14}
                        color={feedbackMap[msg.id]==="up" ? C.primary : TXT2}/>
                    </Pressable>
                    {/* Thumbs down */}
                    <Pressable onPress={()=>sendFeedback(msg,"down")}
                      style={({pressed})=>[s.footBtn,{opacity:pressed?.6:1}]}>
                      <Feather name="thumbs-down" size={14}
                        color={feedbackMap[msg.id]==="down" ? C.destructive : TXT2}/>
                    </Pressable>
                    <View style={{flex:1}}/>
                    <Text style={[s.footTime,{color:TXT2}]}>{fmtTime(msg.ts)}</Text>
                  </View>
                ) : (
                  <Text style={[s.userTime,{color:"rgba(255,255,255,0.5)"}]}>
                    {fmtDate(msg.ts)} {fmtTime(msg.ts)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* ── INPUT BAR (chat mode only) ── */}
        {!isCallMode && (
          <View style={[s.inputBar,{
            backgroundColor: SURF,
            borderTopColor: BD,
            paddingBottom: Math.max(insets.bottom,10),
            marginBottom: tabBarH,
          }]}>
            {/* Mic */}
            <Pressable onPress={voiceButtonAction} disabled={voiceState==="processing"}
              style={[s.circleBtn,{
                backgroundColor: voiceState==="recording" ? C.destructive+"22" : C.muted,
                borderColor: voiceState==="recording" ? C.destructive : BD,
              }]}>
              <Feather name={voiceState==="recording"?"square":"mic"} size={18}
                color={voiceState==="recording"?C.destructive:TXT2}/>
            </Pressable>

            {/* Text input */}
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ketik pesan ke TERRA..."
              placeholderTextColor={TXT2}
              style={[s.textInput,{backgroundColor:C.muted,color:TXT}]}
              onSubmitEditing={()=>sendText(inputText)}
              returnKeyType="send"
              multiline
            />

            {/* Send */}
            <Pressable onPress={()=>sendText(inputText)} disabled={!inputText.trim()}
              style={({pressed})=>[s.sendBtn,{
                backgroundColor: inputText.trim() ? A : C.muted,
                opacity: pressed ? .8 : 1,
              }]}>
              <Feather name="send" size={17} color={inputText.trim()?"#fff":TXT2}/>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:         {flex:1,flexDirection:"row"},
  overlay:      {...StyleSheet.absoluteFillObject,zIndex:10,backgroundColor:"rgba(0,0,0,0.45)"},

  // Sidebar
  sidebar:      {position:"absolute",left:0,top:0,bottom:0,zIndex:20,borderRightWidth:1,overflow:"hidden"},
  sbHead:       {padding:14,borderBottomWidth:1},
  sbLogo:       {flexDirection:"row",alignItems:"center",marginBottom:10},
  sbLogoIcon:   {width:28,height:28,borderRadius:7,alignItems:"center",justifyContent:"center",marginRight:8},
  sbLogoIconTxt:{color:"#fff",fontSize:14,fontWeight:"700"},
  sbLogoName:   {fontSize:15,fontWeight:"700"},
  sbNewBtn:     {flexDirection:"row",alignItems:"center",paddingVertical:8,paddingHorizontal:10,borderRadius:8,borderWidth:1},
  sbNewTxt:     {fontSize:12,marginLeft:6},
  sbList:       {flex:1,paddingHorizontal:8,paddingTop:4},
  sbLabel:      {fontSize:10,fontWeight:"600",letterSpacing:.8,paddingHorizontal:4,paddingVertical:6},
  sbEmpty:      {fontSize:13,textAlign:"center",marginTop:16,lineHeight:20},
  sbItem:       {flexDirection:"row",alignItems:"center",padding:8,borderRadius:8,marginBottom:2},
  sbItemTitle:  {fontSize:12,fontWeight:"500"},
  sbItemMeta:   {fontSize:10,marginTop:1},
  sbFoot:       {flexDirection:"row",padding:10,borderTopWidth:1,gap:4},
  sbFootBtn:    {flex:1,flexDirection:"row",alignItems:"center",justifyContent:"center",padding:7,borderRadius:6},
  sbFootTxt:    {fontSize:12,marginLeft:5},

  // Main
  main:         {flex:1},

  // Header
  header:       {flexDirection:"row",alignItems:"center",paddingHorizontal:10,paddingBottom:10,borderBottomWidth:1,gap:4},
  hdrBtn:       {width:34,height:34,alignItems:"center",justifyContent:"center"},
  hdrPill:      {flexDirection:"row",alignItems:"center",paddingHorizontal:10,paddingVertical:5,borderRadius:8,borderWidth:1},
  hdrDot:       {width:7,height:7,borderRadius:4,marginRight:6},
  hdrPillTxt:   {fontSize:14,fontWeight:"700",marginRight:4},
  hdrPillSub:   {fontSize:11},
  hdrCallPill:  {flexDirection:"row",alignItems:"center",paddingHorizontal:10,paddingVertical:6,borderRadius:8,borderWidth:1},
  hdrCallTxt:   {fontSize:12,fontWeight:"600",marginLeft:4},

  // Error banner
  errBanner:    {flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:8,borderBottomWidth:1,gap:8},
  errTxt:       {flex:1,fontSize:12},

  // Call banner
  callBanner:   {alignItems:"center",paddingVertical:24,paddingHorizontal:24,gap:8},
  callAvatar:   {width:80,height:80,borderRadius:40,alignItems:"center",justifyContent:"center",borderWidth:2},
  callAvatarTxt:{fontSize:36,fontWeight:"700",color:"#4CAF50"},
  callStatus:   {fontSize:18,fontWeight:"700"},
  callTranscript:{fontSize:13,fontStyle:"italic",textAlign:"center"},
  voiceBtn:     {width:64,height:64,borderRadius:32,alignItems:"center",justifyContent:"center",marginTop:4},
  voiceHint:    {fontSize:12},

  // Chat
  chatList:     {padding:16,flexGrow:1,gap:8},
  loadRow:      {flexDirection:"row",alignItems:"center",justifyContent:"center",paddingVertical:24,gap:8},
  loadTxt:      {fontSize:13},
  empty:        {flex:1,alignItems:"center",paddingTop:40,gap:12},
  emptyIcon:    {width:64,height:64,borderRadius:32,alignItems:"center",justifyContent:"center"},
  emptyTitle:   {fontSize:18,fontWeight:"700"},
  emptyDesc:    {fontSize:14,textAlign:"center",lineHeight:20,maxWidth:280},
  chip:         {flexDirection:"row",alignItems:"center",justifyContent:"space-between",width:"100%",padding:12,borderRadius:8,borderWidth:1,gap:8},
  chipTxt:      {fontSize:14,flex:1},

  // Bubbles
  wrapUser:     {alignItems:"flex-end"},
  wrapBot:      {alignItems:"flex-start"},
  bubble:       {maxWidth:"86%",borderRadius:14,overflow:"hidden"},
  bubbleUser:   {paddingHorizontal:12,paddingTop:10,paddingBottom:8},
  bubbleBot:    {borderWidth:1,paddingHorizontal:12,paddingTop:10,paddingBottom:0},
  botName:      {fontSize:11,fontWeight:"700",marginBottom:3},
  bubbleTxt:    {fontSize:14,lineHeight:21},
  bubFoot:      {flexDirection:"row",alignItems:"center",marginTop:8,paddingTop:6,paddingBottom:7,borderTopWidth:1},
  footBtn:      {paddingHorizontal:6,paddingVertical:3,borderRadius:5},
  footTime:     {fontSize:11},
  userTime:     {fontSize:10,marginTop:4,textAlign:"right",paddingBottom:8},

  // Input
  inputBar:     {flexDirection:"row",alignItems:"flex-end",padding:10,borderTopWidth:1,gap:6},
  circleBtn:    {width:38,height:38,borderRadius:19,alignItems:"center",justifyContent:"center",borderWidth:1},
  textInput:    {flex:1,borderRadius:12,paddingHorizontal:12,paddingTop:10,paddingBottom:10,fontSize:14,maxHeight:100},
  sendBtn:      {width:38,height:38,borderRadius:19,alignItems:"center",justifyContent:"center"},
});
