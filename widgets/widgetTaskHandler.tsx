import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { type WidgetTaskHandler } from 'react-native-android-widget';
import { buildApi, DEFAULT_BASE_URL, SERVER_URL_KEY } from '@/constants/api';
import { TemperatureWidget } from './TemperatureWidget';
import { HumidityWidget } from './HumidityWidget';
import { IncubationWidget } from './IncubationWidget';

type WidgetName = 'TemperatureWidget' | 'HumidityWidget' | 'IncubationWidget';

// Shorter timeout for widget context — 6s max
function fetchJson(url: string, ms = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => clearTimeout(t));
}

/** Shown when server is offline or widget crashes */
function OfflineWidget({ label }: { label: string }) {
  return (
    <FlexWidget style={{
      height: 'match_parent', width: 'match_parent',
      flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      backgroundColor: '#131929',
    }}>
      <TextWidget text={label} style={{ fontSize: 12, color: '#6B7A94', fontFamily: 'sans-serif' }} />
      <TextWidget text="Offline" style={{ fontSize: 10, color: '#4B5A6E', fontFamily: 'sans-serif' }} />
    </FlexWidget>
  );
}

function safeRender(
  renderWidget: (el: React.ReactElement) => void,
  el: React.ReactElement,
  fallback: string,
) {
  try {
    renderWidget(el);
  } catch (e) {
    console.error('Widget render error:', e);
    try { renderWidget(<OfflineWidget label={fallback} />); } catch (_) {}
  }
}

export const widgetTaskHandler: WidgetTaskHandler = async ({
  widgetInfo, widgetAction, renderWidget,
}) => {
  if (widgetAction === 'WIDGET_DELETED') return;

  const widgetName = widgetInfo.widgetName as WidgetName;

  // Get stored server URL
  let serverUrl = DEFAULT_BASE_URL;
  try {
    serverUrl = (await AsyncStorage.getItem(SERVER_URL_KEY)) ?? DEFAULT_BASE_URL;
  } catch (_) {}

  const api = buildApi(serverUrl);

  // Fetch all data concurrently with short timeout
  let sensor: Record<string, number> | null = null;
  let incubation: Record<string, unknown> | null = null;
  let tempHistory: number[] = [];
  let humHistory: number[] = [];

  try {
    const [sRes, iRes, hRes] = await Promise.allSettled([
      fetchJson(api.sensorLatest),
      fetchJson(api.incubationCurrent),
      fetchJson(api.sensorHistory(60)),
    ]);

    if (sRes.status === 'fulfilled') {
      const v = sRes.value as Record<string, unknown>;
      sensor = (v?.sensor ?? v) as Record<string, number> | null;
    }
    if (iRes.status === 'fulfilled') {
      incubation = iRes.value as Record<string, unknown> | null;
    }
    if (hRes.status === 'fulfilled') {
      const records = Array.isArray(hRes.value) ? hRes.value as Record<string, number>[] : [];
      const recent = records.slice(-20);
      tempHistory = recent.map(r => Number(r.temp ?? 0)).filter(Boolean);
      humHistory  = recent.map(r => Number(r.humidity ?? 0)).filter(Boolean);
    }
  } catch (e) {
    console.error('Widget fetch error:', e);
    // sensor stays null → widgets render in offline/placeholder state
  }

  switch (widgetName) {
    case 'TemperatureWidget':
      safeRender(
        renderWidget,
        <TemperatureWidget
          sensor={sensor as Parameters<typeof TemperatureWidget>[0]['sensor']}
          history={tempHistory}
        />,
        'Suhu tidak tersedia',
      );
      break;

    case 'HumidityWidget':
      safeRender(
        renderWidget,
        <HumidityWidget
          sensor={sensor as Parameters<typeof HumidityWidget>[0]['sensor']}
          history={humHistory}
        />,
        'Kelembapan tidak tersedia',
      );
      break;

    case 'IncubationWidget':
      safeRender(
        renderWidget,
        <IncubationWidget incubation={incubation} sensor={sensor} />,
        'Inkubasi tidak tersedia',
      );
      break;

    default:
      safeRender(
        renderWidget,
        <TemperatureWidget sensor={null} history={[]} />,
        'Widget tidak dikenal',
      );
  }
};
