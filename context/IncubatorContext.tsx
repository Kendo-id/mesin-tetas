import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { buildApi, DEFAULT_BASE_URL, SERVER_URL_KEY } from "@/constants/api";

export interface SensorData {
  temp: number;
  temp_ds1: number;
  temp_ds2: number;
  temp_sht: number;
  humidity: number;
  target_temp: number;
  target_humid: number;
}

export interface DeviceStatus {
  heater: boolean;
  humidifier: boolean;
  fan: boolean;
  auto_mode: boolean;
  tray_tilted: boolean;
  tray_position: string;
  motor_state: string;
  turn_interval_min: number;
  turn_duration_sec: number;
}

export interface IncubationSession {
  active: boolean;
  id?: number;
  started_at?: number;
  species?: string;
  total_days?: number;
  total_eggs?: number;
  elapsed_days?: number;
  notes?: string;
}

export interface ServerConfig {
  mqtt_host: string;
  mqtt_port: number;
  device_id: string;
  topics?: Record<string, string>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  url?: string;
}

const DEFAULT_SENSOR: SensorData = {
  temp: 0, temp_ds1: 0, temp_ds2: 0, temp_sht: 0,
  humidity: 0, target_temp: 37.5, target_humid: 60,
};

const DEFAULT_STATUS: DeviceStatus = {
  heater: false, humidifier: false, fan: false, auto_mode: true,
  tray_tilted: false, tray_position: "center", motor_state: "stop",
  turn_interval_min: 120, turn_duration_sec: 8,
};

interface IncubatorContextType {
  sensor: SensorData;
  status: DeviceStatus;
  incubation: IncubationSession;
  serverConfig: ServerConfig | null;
  isConnected: boolean;
  isLoading: boolean;
  lastUpdated: Date | null;
  lastError: string | null;
  serverUrl: string;
  sendCommand: (command: string, value: unknown) => Promise<boolean>;
  refreshNow: () => void;
  updateServerUrl: (url: string) => Promise<void>;
  testConnection: (url?: string) => Promise<TestResult>;
}

const IncubatorContext = createContext<IncubatorContextType | null>(null);

/**
 * fetchWithTimeout: pengganti AbortSignal.timeout() yang TIDAK didukung
 * di React Native Hermes engine. AbortSignal.timeout() hanya ada di Node.js 17.3+
 * dan browser modern — di Hermes langsung throw TypeError sehingga semua fetch gagal.
 */
function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export function IncubatorProvider({ children }: { children: React.ReactNode }) {
  const [sensor, setSensor] = useState<SensorData>(DEFAULT_SENSOR);
  const [status, setStatus] = useState<DeviceStatus>(DEFAULT_STATUS);
  const [incubation, setIncubation] = useState<IncubationSession>({ active: false });
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // apiRef — rebuild hanya saat serverUrl berubah, tidak trigger re-render
  const apiRef = useRef(buildApi(serverUrl));
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_BASE_URL);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiRef = useRef(buildApi(DEFAULT_BASE_URL));

  useEffect(() => {
    AsyncStorage.getItem(SERVER_URL_KEY).then((saved) => {
      if (saved) {
        setServerUrl(saved);
        apiRef.current = buildApi(saved);
      }
    });
  }, []);

  const fetchSensorData = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(apiRef.current.sensorLatest, {}, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText || "Server error"}`);
      const data = await res.json();
      if (data.sensor) setSensor((prev) => ({ ...prev, ...data.sensor }));
      if (data.status) setStatus((prev) => ({ ...prev, ...data.status }));
      setIsConnected(true);
      setLastError(null);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setIsConnected(false);
      const raw = e instanceof Error ? e.message : String(e);
      // Buat pesan error yang lebih mudah dipahami
      let friendly = raw;
      if (raw.includes("aborted") || raw.includes("abort") || raw.includes("timeout")) {
        friendly = "Timeout — server tidak merespons dalam 8 detik. Cek URL dan port.";
      } else if (raw.includes("Network request failed") || raw.includes("Failed to fetch")) {
        friendly = "Gagal terhubung jaringan — cek URL, IP lokal, dan port server Flask.";
      } else if (raw.includes("ECONNREFUSED")) {
        friendly = "Koneksi ditolak — pastikan Flask server sudah berjalan.";
      }
      setLastError(friendly);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchIncubation = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(apiRef.current.incubationCurrent, {}, 8000);
      if (!res.ok) return;
      const data = await res.json();
      setIncubation(data);
    } catch {}
  }, []);

  const fetchServerConfig = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(apiRef.current.config, {}, 8000);
      if (!res.ok) return;
      const data: ServerConfig = await res.json();
      setServerConfig(data);
    } catch {}
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    fetchSensorData();
    fetchIncubation();
    fetchServerConfig();
    pollRef.current = setInterval(fetchSensorData, 3000);
  }, [fetchSensorData, fetchIncubation, fetchServerConfig]);

  useEffect(() => {
    startPolling();
    const incubationPoll = setInterval(fetchIncubation, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearInterval(incubationPoll);
    };
  }, [startPolling, fetchIncubation]);

  const sendCommand = useCallback(async (command: string, value: unknown): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout(
        apiRef.current.command,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, value }),
        },
        10000
      );
      if (!res.ok) return false;
      const data = await res.json();
      await fetchSensorData();
      return data.ok === true;
    } catch {
      return false;
    }
  }, [fetchSensorData]);

  const refreshNow = useCallback(() => {
    fetchSensorData();
    fetchIncubation();
    fetchServerConfig();
  }, [fetchSensorData, fetchIncubation, fetchServerConfig]);

  // Update apiRef setiap kali serverUrl berubah
  useEffect(() => {
    apiRef.current = buildApi(serverUrl);
  }, [serverUrl]);

  const updateServerUrl = useCallback(async (url: string) => {
    const clean = url.replace(/\/$/, "");
    await AsyncStorage.setItem(SERVER_URL_KEY, clean);
    setServerUrl(clean);
    setServerConfig(null);
    setIsConnected(false);
    setLastError(null);
    apiRef.current = buildApi(clean);
    startPolling();
  }, [startPolling]);

  /**
   * testConnection: tes koneksi ke URL tertentu (atau URL aktif).
   * Mengembalikan hasil detail termasuk latensi dan pesan error.
   */
  const testConnection = useCallback(async (url?: string): Promise<TestResult> => {
    const testBase = url ? url.replace(/\/$/, "") : serverUrl;
    const testUrl = buildApi(testBase).sensorLatest;
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(testUrl, {}, 10000);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          message: `Server merespons dengan error: HTTP ${res.status} ${res.statusText}`,
          latencyMs,
          url: testUrl,
        };
      }
      await res.json();
      return {
        ok: true,
        message: `Terhubung! Latensi: ${latencyMs}ms`,
        latencyMs,
        url: testUrl,
      };
    } catch (e: unknown) {
      const latencyMs = Date.now() - start;
      const raw = e instanceof Error ? e.message : String(e);
      let message = raw;
      if (raw.includes("aborted") || raw.includes("abort") || raw.includes("timeout")) {
        message = `Timeout setelah ${latencyMs}ms — server tidak merespons.\nCek: apakah port sudah benar? Coba http://IP:5000/terrabreed`;
      } else if (raw.includes("Network request failed") || raw.includes("Failed to fetch")) {
        message = "Gagal koneksi jaringan.\nCek: IP lokal benar, Flask server berjalan, port tidak diblokir firewall.";
      }
      return { ok: false, message, latencyMs, url: testUrl };
    }
  }, [serverUrl]);

  return (
    <IncubatorContext.Provider
      value={{
        sensor, status, incubation, serverConfig,
        isConnected, isLoading, lastUpdated, lastError,
        serverUrl, sendCommand, refreshNow, updateServerUrl, testConnection,
      }}
    >
      {children}
    </IncubatorContext.Provider>
  );
}

export function useIncubator() {
  const ctx = useContext(IncubatorContext);
  if (!ctx) throw new Error("useIncubator must be used within IncubatorProvider");
  return ctx;
}
