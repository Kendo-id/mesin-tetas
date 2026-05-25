import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { API } from "@/constants/api";

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
  temp: 0,
  temp_ds1: 0,
  temp_ds2: 0,
  temp_sht: 0,
  humidity: 0,
  target_temp: 37.5,
  target_humid: 60,
};

const DEFAULT_STATUS: DeviceStatus = {
  heater: false,
  humidifier: false,
  fan: false,
  auto_mode: true,
  tray_tilted: false,
  tray_position: "center",
  motor_state: "stop",
  turn_interval_min: 120,
  turn_duration_sec: 8,
};

interface IncubatorContextType {
  sensor: SensorData;
  status: DeviceStatus;
  incubation: IncubationSession;
  isConnected: boolean;
  isLoading: boolean;
  lastUpdated: Date | null;
  sendCommand: (command: string, value: unknown) => Promise<boolean>;
  refreshNow: () => void;
}

const IncubatorContext = createContext<IncubatorContextType | null>(null);

export function IncubatorProvider({ children }: { children: React.ReactNode }) {
  const [sensor, setSensor] = useState<SensorData>(DEFAULT_SENSOR);
  const [status, setStatus] = useState<DeviceStatus>(DEFAULT_STATUS);
  const [incubation, setIncubation] = useState<IncubationSession>({ active: false });
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSensorData = useCallback(async () => {
    try {
      const res = await fetch(API.sensorLatest, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data.sensor && Object.keys(data.sensor).length > 0) {
        setSensor((prev) => ({ ...prev, ...data.sensor }));
      }
      if (data.status && Object.keys(data.status).length > 0) {
        setStatus((prev) => ({ ...prev, ...data.status }));
      }
      setIsConnected(true);
      setLastUpdated(new Date());
    } catch {
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchIncubation = useCallback(async () => {
    try {
      const res = await fetch(API.incubationCurrent, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      setIncubation(data);
    } catch {}
  }, []);

  const startPolling = useCallback(() => {
    fetchSensorData();
    fetchIncubation();
    pollRef.current = setInterval(() => {
      fetchSensorData();
    }, 3000);
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
      const res = await fetch(API.command, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, value }),
        signal: AbortSignal.timeout(5000),
      });
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

  return (
    <IncubatorContext.Provider
      value={{ sensor, status, incubation, isConnected, isLoading, lastUpdated, sendCommand, refreshNow }}
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
