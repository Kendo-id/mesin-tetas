import React from 'react';
  import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

  interface Props {
    sensor: { humidity: number; target_humid?: number } | null;
    history?: number[];
  }

  function buildSparkline(values: number[], w = 160, h = 36): string {
    if (!values || values.length < 2) return '';
    const min = Math.min(...values) - 1;
    const max = Math.max(...values) + 1;
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = ((i / (values.length - 1)) * w).toFixed(1);
      const y = (h - ((v - min) / range) * (h - 6) - 3).toFixed(1);
      return x + ',' + y;
    });
    return 'M ' + pts.join(' L ');
  }

  export function HumidityWidget({ sensor, history = [] }: Props) {
    const humidity = sensor?.humidity ?? 0;
    const target   = sensor?.target_humid ?? 60;
    const spark    = buildSparkline(history);

    const dropSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" stroke="#4B9EFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
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

    const isHigh = humidity > target + 5;
    const isLow  = humidity < target - 5;
    const valColor = isHigh ? '#F87171' : isLow ? '#FBBF24' : '#FFFFFF';

    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: '#131929', borderRadius: 20, padding: 14 }}>
        <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextWidget text="KELEMBAPAN" style={{ fontSize: 10, color: '#8B9AB3' }} />
          <SvgWidget svg={dropSvg} width={22} height={22} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 }}>
          <TextWidget text={humidity.toFixed(1)} style={{ fontSize: 42, color: valColor, fontFamily: 'sans-serif-medium' }} />
          <TextWidget text="  %" style={{ fontSize: 16, color: '#8B9AB3' }} />
        </FlexWidget>
        <FlexWidget style={{ marginTop: 4, marginBottom: 4 }}>
          <SvgWidget svg={chartSvg} width={160} height={36} />
        </FlexWidget>
        <TextWidget
          text={"Target: " + target + "%"}
          style={{ fontSize: 11, color: '#6B7A94' }}
        />
      </FlexWidget>
    );
  }
  