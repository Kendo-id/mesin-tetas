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
  isConnected: boolean;
  isLoading: boolean;
  lastUpdated: Date | null;
  lastError: string | null;
  serverUrl: string;
  sendCommand: (command: string, value: unknown) => Promise<boolean>;
  refreshNow: () => void;
  updateServerUrl: (url: string) => Promise<void>;
}

const IncubatorContext = createContext<IncubatorContextType | null>(null);

/**
 * fetchWithTimeout: ganti AbortSignal.timeout() yang tidak didukung di React Native / Hermes.
 * AbortSignal.timeout() hanya tersedia di Node.js 17.3+ dan browser modern,
 * bukan di Hermes engine — sehingga setiap fetch langsung throw TypeError.
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
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_BASE_URL);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiRef = useRef(buildApi(DEFAULT_BASE_URL));

  // Load server URL dari AsyncStorage saat start
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
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.sensor) setSensor((prev) => ({ ...prev, ...data.sensor }));
      if (data.status) setStatus((prev) => ({ ...prev, ...data.status }));
      setIsConnected(true);
      setLastError(null);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setIsConnected(false);
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
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

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    fetchSensorData();
    fetchIncubation();
    pollRef.current = setInterval(fetchSensorData, 3000);
  }, [fetchSensorData, fetchIncubation]);

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
  }, [fetchSensorData, fetchIncubation]);

  const updateServerUrl = useCallback(async (url: string) => {
    const clean = url.replace(/\/$/, "");
    await AsyncStorage.setItem(SERVER_URL_KEY, clean);
    setServerUrl(clean);
    apiRef.current = buildApi(clean);
    startPolling();
  }, [startPolling]);

  return (
    <IncubatorContext.Provider
      value={{
        sensor, status, incubation, isConnected, isLoading,
        lastUpdated, lastError, serverUrl, sendCommand, refreshNow, updateServerUrl,
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
