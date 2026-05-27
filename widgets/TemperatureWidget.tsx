import React from 'react';
  import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

  interface Props {
    sensor: {
      temp: number;
      temp_ds1: number;
      temp_ds2: number;
      temp_sht: number;
    } | null;
    history?: number[];
  }

  function buildSparkline(values: number[], w = 160, h = 36): string {
    if (!values || values.length < 2) return '';
    const min = Math.min(...values) - 0.2;
    const max = Math.max(...values) + 0.2;
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = ((i / (values.length - 1)) * w).toFixed(1);
      const y = (h - ((v - min) / range) * (h - 6) - 3).toFixed(1);
      return x + ',' + y;
    });
    return 'M ' + pts.join(' L ');
  }

  export function TemperatureWidget({ sensor, history = [] }: Props) {
    const temp  = sensor?.temp     ?? 0;
    const ds1   = sensor?.temp_ds1 ?? 0;
    const ds2   = sensor?.temp_ds2 ?? 0;
    const sht   = sensor?.temp_sht ?? 0;
    const spark = buildSparkline(history);

    const thermometerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" stroke="#4B9EFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    const chartSvg = spark
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="36" viewBox="0 0 160 36">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2563EB" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#2563EB" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${spark} V36 L0,36 Z" fill="url(#g)"/>
          <path d="${spark}" stroke="#4B9EFF" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="36" viewBox="0 0 160 36">
          <line x1="0" y1="18" x2="160" y2="18" stroke="#374151" stroke-width="1" stroke-dasharray="4,4"/>
        </svg>`;

    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: '#131929', borderRadius: 20, padding: 14 }}>
        <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextWidget text="SUHU REALTIME" style={{ fontSize: 10, color: '#8B9AB3' }} />
          <SvgWidget svg={thermometerSvg} width={22} height={22} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 }}>
          <TextWidget text={temp.toFixed(1)} style={{ fontSize: 42, color: '#FFFFFF', fontFamily: 'sans-serif-medium' }} />
          <TextWidget text="  \u00B0C" style={{ fontSize: 16, color: '#8B9AB3' }} />
        </FlexWidget>
        <FlexWidget style={{ marginTop: 4, marginBottom: 4 }}>
          <SvgWidget svg={chartSvg} width={160} height={36} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <FlexWidget style={{ flexDirection: 'column' }}>
            <TextWidget text="DS18B20 #1" style={{ fontSize: 9, color: '#6B7A94' }} />
            <TextWidget text={ds1.toFixed(2) + '\u00B0C'} style={{ fontSize: 11, color: '#CBD5E6', fontFamily: 'sans-serif-medium' }} />
          </FlexWidget>
          <FlexWidget style={{ flexDirection: 'column' }}>
            <TextWidget text="DS18B20 #2" style={{ fontSize: 9, color: '#6B7A94' }} />
            <TextWidget text={ds2.toFixed(2) + '\u00B0C'} style={{ fontSize: 11, color: '#CBD5E6', fontFamily: 'sans-serif-medium' }} />
          </FlexWidget>
          <FlexWidget style={{ flexDirection: 'column' }}>
            <TextWidget text="SHT31" style={{ fontSize: 9, color: '#6B7A94' }} />
            <TextWidget text={sht.toFixed(2) + '\u00B0C'} style={{ fontSize: 11, color: '#CBD5E6', fontFamily: 'sans-serif-medium' }} />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
    );
  }
  