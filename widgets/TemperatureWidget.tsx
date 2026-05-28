import React from 'react';
  import { FlexWidget, TextWidget } from 'react-native-android-widget';

  interface SensorData {
    temperature?: number | null;
    humidity?: number | null;
  }

  interface Props {
    sensor: SensorData | null;
  }

  export function TemperatureWidget({ sensor }: Props) {
    const temp = sensor?.temperature != null ? sensor.temperature.toFixed(1) : '--';
    const isOnline = sensor?.temperature != null;
    const tempNum = sensor?.temperature ?? 0;
    const isAlert = isOnline && (tempNum < 35 || tempNum > 38.5);
    const statusText = isOnline ? (isAlert ? 'Peringatan!' : 'Live') : 'Offline';
    const tempColor = isAlert ? '#EF4444' : isOnline ? '#F59E0B' : '#6B7280';
    const statusColor = isAlert ? '#EF4444' : isOnline ? '#22C55E' : '#6B7280';

    return (
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          flexDirection: 'column',
          justifyContent: 'space_between',
          alignItems: 'center',
          backgroundColor: '#0F172A',
          padding: 12,
        }}
      >
        <TextWidget
          text="Suhu Mesin Tetas"
          style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'sans-serif', width: 'match_parent' }}
        />
        <TextWidget
          text={temp + ' C'}
          style={{ fontSize: 38, color: tempColor, fontFamily: 'sans-serif', fontStyle: 'bold', width: 'match_parent' }}
        />
        <TextWidget
          text={'Status: ' + statusText + '  |  Ideal: 37-38 C'}
          style={{ fontSize: 10, color: statusColor, fontFamily: 'sans-serif', width: 'match_parent' }}
        />
        <TextWidget
          text="TerraBreed"
          style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif', width: 'match_parent' }}
        />
      </FlexWidget>
    );
  }
  