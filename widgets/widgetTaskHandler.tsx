import React from 'react';
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import { type WidgetTaskHandler } from 'react-native-android-widget';
  import { buildApi, DEFAULT_BASE_URL, SERVER_URL_KEY } from '@/constants/api';
  import { TemperatureWidget } from './TemperatureWidget';
  import { HumidityWidget } from './HumidityWidget';
  import { IncubationWidget } from './IncubationWidget';

  type WidgetName = 'TemperatureWidget' | 'HumidityWidget' | 'IncubationWidget';

  function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  export const widgetTaskHandler: WidgetTaskHandler = async ({
    widgetInfo,
    widgetAction,
    renderWidget,
  }) => {
    if (widgetAction === 'WIDGET_DELETED') return;

    const widgetName = widgetInfo.widgetName as WidgetName;
    const serverUrl = (await AsyncStorage.getItem(SERVER_URL_KEY)) ?? DEFAULT_BASE_URL;
    const api = buildApi(serverUrl);

    let sensor: Record<string, number> | null = null;
    let incubation: Record<string, unknown> | null = null;
    let tempHistory: number[] = [];
    let humHistory: number[] = [];

    try {
      const [sRes, iRes, hRes] = await Promise.allSettled([
        fetchWithTimeout(api.sensorLatest).then(r => r.json()),
        fetchWithTimeout(api.incubationCurrent).then(r => r.json()),
        fetchWithTimeout(api.sensorHistory(60)).then(r => r.json()),
      ]);
      if (sRes.status === 'fulfilled') sensor = sRes.value?.sensor ?? sRes.value ?? null;
      if (iRes.status === 'fulfilled') incubation = iRes.value ?? null;
      if (hRes.status === 'fulfilled') {
        const records: Array<Record<string, number>> = Array.isArray(hRes.value) ? hRes.value : [];
        const recent = records.slice(-20);
        tempHistory = recent.map(r => Number(r.temp ?? 0)).filter(Boolean);
        humHistory  = recent.map(r => Number(r.humidity ?? 0)).filter(Boolean);
      }
    } catch (_) {}

    switch (widgetName) {
      case 'TemperatureWidget':
        renderWidget(
          <TemperatureWidget
            sensor={sensor as Parameters<typeof TemperatureWidget>[0]['sensor']}
            history={tempHistory}
          />
        );
        break;
      case 'HumidityWidget':
        renderWidget(
          <HumidityWidget
            sensor={sensor as Parameters<typeof HumidityWidget>[0]['sensor']}
            history={humHistory}
          />
        );
        break;
      case 'IncubationWidget':
        renderWidget(<IncubationWidget incubation={incubation} sensor={sensor} />);
        break;
      default:
        renderWidget(<TemperatureWidget sensor={null} history={[]} />);
    }
  };
  