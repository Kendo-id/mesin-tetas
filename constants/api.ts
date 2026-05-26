import AsyncStorage from "@react-native-async-storage/async-storage";

export const DEFAULT_BASE_URL = "https://kendo-assistant.com/terrabreed";
export const SERVER_URL_KEY = "server_base_url";

export async function getBaseUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
    return saved ?? DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export async function setBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(SERVER_URL_KEY, url.replace(/\/$/, ""));
}

export function buildApi(base: string) {
  return {
    sensorLatest: `${base}/api/sensor/latest`,
    sensorHistory: (minutes: number) => `${base}/api/sensor/history?minutes=${minutes}`,
    sensorStats: `${base}/api/sensor/stats`,
    alarms: (limit = 20) => `${base}/api/alarms?limit=${limit}`,
    chat: `${base}/api/chat`,
    chatClear: `${base}/api/chat/clear`,
    command: `${base}/api/command`,
    incubationCurrent: `${base}/api/incubation/current`,
    incubationStart: `${base}/api/incubation/start`,
    incubationFinish: `${base}/api/incubation/finish`,
    settings: `${base}/api/settings`,
    tts: `${base}/api/tts`,
    stt: `${base}/api/stt`,
  };
}

// Export static API untuk backward compat — akan diupdate di context
export const API = buildApi(DEFAULT_BASE_URL);
