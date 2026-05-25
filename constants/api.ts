export const BASE_URL = "https://kendo-assistant.com/terrabreed";

export const API = {
  sensorLatest: `${BASE_URL}/api/sensor/latest`,
  sensorHistory: (minutes: number) => `${BASE_URL}/api/sensor/history?minutes=${minutes}`,
  sensorStats: `${BASE_URL}/api/sensor/stats`,
  alarms: (limit = 20) => `${BASE_URL}/api/alarms?limit=${limit}`,
  chat: `${BASE_URL}/api/chat`,
  chatClear: `${BASE_URL}/api/chat/clear`,
  command: `${BASE_URL}/api/command`,
  incubationCurrent: `${BASE_URL}/api/incubation/current`,
  incubationStart: `${BASE_URL}/api/incubation/start`,
  incubationFinish: `${BASE_URL}/api/incubation/finish`,
  settings: `${BASE_URL}/api/settings`,
  tts: `${BASE_URL}/api/tts`,
  stt: `${BASE_URL}/api/stt`,
};
