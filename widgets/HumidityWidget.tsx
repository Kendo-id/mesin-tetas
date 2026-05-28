import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

interface Props {
  sensor: { humidity: number; target_humid?: number } | null;
  history?: number[];
}

export function HumidityWidget({ sensor }: Props) {
  const offline  = sensor === null;
  const humidity = sensor?.humidity    ?? 0;
  const target   = sensor?.target_humid ?? 60;

  const isHigh = !offline && humidity > target + 5;
  const isLow  = !offline && humidity < target - 5;
  const valColor = offline ? '#4B5A6E' : isHigh ? '#F87171' : isLow ? '#FBBF24' : '#FFFFFF';
  const status   = offline ? 'Offline' : isHigh ? 'Tinggi' : isLow ? 'Rendah' : 'Normal';

  return (
    <FlexWidget style={{
      height: 'match_parent', width: 'match_parent',
      flexDirection: 'column', justifyContent: 'space-between',
      backgroundColor: '#131929',
      paddingTop: 12, paddingBottom: 12, paddingLeft: 14, paddingRight: 14,
    }}>
      <TextWidget
        text="Kelembapan"
        style={{ fontSize: 11, color: '#8B9AB3', fontFamily: 'sans-serif' }}
      />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <TextWidget
          text={offline ? '--' : humidity.toFixed(1)}
          style={{ fontSize: 40, color: valColor, fontFamily: 'sans-serif' }}
        />
        <TextWidget
          text="%"
          style={{ fontSize: 16, color: '#8B9AB3', fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <TextWidget
          text={'Target: ' + (offline ? '--' : target + '%')}
          style={{ fontSize: 11, color: '#6B7A94', fontFamily: 'sans-serif' }}
        />
        <TextWidget
          text={status}
          style={{ fontSize: 11, color: valColor, fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
