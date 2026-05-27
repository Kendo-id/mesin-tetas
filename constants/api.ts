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
    const b = base.replace(/\/$/, "");
    return {
      sensorLatest:      `${b}/api/sensor/latest`,
      sensorHistory:     (minutes: number) => `${b}/api/sensor/history?minutes=${minutes}`,
      sensorStats:       `${b}/api/sensor/stats`,
      alarms:            (limit = 20) => `${b}/api/alarms?limit=${limit}`,
      chat:              `${b}/api/chat`,
      chatClear:         `${b}/api/chat/clear`,
      chatHistory:       (limit = 100) => `${b}/api/chat/history?limit=${limit}`,
      chatFeedback:      `${b}/api/chat/feedback`,
      command:           `${b}/api/command`,
      config:            `${b}/api/config`,
      incubationCurrent: `${b}/api/incubation/current`,
      incubationStart:   `${b}/api/incubation/start`,
      incubationFinish:  `${b}/api/incubation/finish`,
      settings:          `${b}/api/settings`,
      tts:               `${b}/api/tts`,
      stt:               `${b}/api/stt`,
    };
  }

  export const API = buildApi(DEFAULT_BASE_URL);
  