import React from 'react';
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import type { WidgetTaskHandler } from 'react-native-android-widget';
  import { TemperatureWidget } from './TemperatureWidget';
  import { HumidityWidget } from './HumidityWidget';
  import { IncubationWidget } from './IncubationWidget';

  const DEFAULT_BASE_URL = 'https://kendo-assistant.com/terrabreed';
  const SERVER_URL_KEY = 'server_url';

  async function fetchJson(url: string, ms = 5000): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  const widgetTaskHandler: WidgetTaskHandler = async ({
    widgetInfo,
    widgetAction,
    renderWidget,
  }) => {
    if (widgetAction === 'WIDGET_DELETED') return;

    const widgetName = widgetInfo.widgetName as string;

    // Render IMMEDIATELY with offline/placeholder state first
    // This ensures Android sees a valid RemoteViews before any async work
    switch (widgetName) {
      case 'TemperatureWidget':
        renderWidget(<TemperatureWidget sensor={null} />);
        break;
      case 'HumidityWidget':
        renderWidget(<HumidityWidget sensor={null} />);
        break;
      case 'IncubationWidget':
        renderWidget(<IncubationWidget session={null} />);
        break;
      default:
        return;
    }

    // Then try to fetch live data and update
    try {
      let base = DEFAULT_BASE_URL;
      try {
        const stored = await AsyncStorage.getItem(SERVER_URL_KEY);
        if (stored) base = stored;
      } catch (_) {}

      const apiBase = base.replace(/\/$/, '');

      if (widgetName === 'TemperatureWidget' || widgetName === 'HumidityWidget') {
        const sensor = await fetchJson(apiBase + '/api/sensor/latest');
        if (widgetName === 'TemperatureWidget') {
          renderWidget(<TemperatureWidget sensor={sensor as any} />);
        } else {
          renderWidget(<HumidityWidget sensor={sensor as any} />);
        }
      } else if (widgetName === 'IncubationWidget') {
        const session = await fetchJson(apiBase + '/api/incubation/current');
        renderWidget(<IncubationWidget session={session as any} />);
      }
    } catch (_) {
      // Offline state from step 1 remains visible
    }
  };

  export { widgetTaskHandler };
  export default widgetTaskHandler;
  