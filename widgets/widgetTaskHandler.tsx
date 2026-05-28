import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
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

/** Fallback widget shown when render throws or fetch fails entirely */
function ErrorWidget({ label }: { label: string }) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#131929',
      }}
    >
      <TextWidget
        text={label}
        style={{ fontSize: 12, color: '#6B7A94', fontFamily: 'sans-serif' }}
      />
      <TextWidget
        text="Tap untuk refresh"
        style={{ fontSize: 10, color: '#4B5A6E', fontFamily: 'sans-serif' }}
      />
    </FlexWidget>
  );
}

/** Safe renderWidget wrapper — catches synchronous render errors */
function safeRender(renderWidget: (el: React.ReactElement) => void, el: React.ReactElement, fallbackLabel: string) {
  try {
    renderWidget(el);
  } catch (e) {
    console.error('Widget render error:', e);
    try {
      renderWidget(<ErrorWidget label={fallbackLabel} />);
    } catch (_) {}
  }
}

export const widgetTaskHandler: WidgetTaskHandler = async ({
  widgetInfo,
  widgetAction,
  renderWidget,
}) => {
  if (widgetAction === 'WIDGET_DELETED') return;

  const widgetName = widgetInfo.widgetName as WidgetName;

  // Show loading state first so widget is never blank
  try {
    renderWidget(
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#131929',
        }}
      >
        <TextWidget
          text="Memuat..."
          style={{ fontSize: 12, color: '#6B7A94', fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
    );
  } catch (_) {}

  let serverUrl = DEFAULT_BASE_URL;
  try {
    serverUrl = (await AsyncStorage.getItem(SERVER_URL_KEY)) ?? DEFAULT_BASE_URL;
  } catch (_) {}

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
  } catch (e) {
    console.error('Widget data fetch error:', e);
  }

  switch (widgetName) {
    case 'TemperatureWidget':
      safeRender(
        renderWidget,
        <TemperatureWidget
          sensor={sensor as Parameters<typeof TemperatureWidget>[0]['sensor']}
          history={tempHistory}
        />,
        'Suhu tidak tersedia'
      );
      break;

    case 'HumidityWidget':
      safeRender(
        renderWidget,
        <HumidityWidget
          sensor={sensor as Parameters<typeof HumidityWidget>[0]['sensor']}
          history={humHistory}
        />,
        'Kelembapan tidak tersedia'
      );
      break;

    case 'IncubationWidget':
      safeRender(
        renderWidget,
        <IncubationWidget incubation={incubation} sensor={sensor} />,
        'Data inkubasi tidak tersedia'
      );
      break;

    default:
      safeRender(
        renderWidget,
        <TemperatureWidget sensor={null} history={[]} />,
        'Widget tidak dikenal'
      );
  }
};
