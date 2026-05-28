import React from 'react';
  import { FlexWidget, TextWidget } from 'react-native-android-widget';

  interface SensorData {
    temperature?: number | null;
    humidity?: number | null;
  }

  interface Props {
    sensor: SensorData | null;
  }

  export function HumidityWidget({ sensor }: Props) {
    const hum = sensor?.humidity != null ? sensor.humidity.toFixed(0) : '--';
    const isOnline = sensor?.humidity != null;
    const humNum = sensor?.humidity ?? 0;
    const isAlert = isOnline && (humNum < 60 || humNum > 75);
    const statusText = isOnline ? (isAlert ? 'Peringatan!' : 'Live') : 'Offline';
    const humColor = isAlert ? '#EF4444' : isOnline ? '#38BDF8' : '#6B7280';
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
          text="Kelembapan Mesin Tetas"
          style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'sans-serif', width: 'match_parent' }}
        />
        <TextWidget
          text={hum + ' %'}
          style={{ fontSize: 38, color: humColor, fontFamily: 'sans-serif', fontStyle: 'bold', width: 'match_parent' }}
        />
        <TextWidget
          text={'Status: ' + statusText + '  |  Ideal: 60-75%'}
          style={{ fontSize: 10, color: statusColor, fontFamily: 'sans-serif', width: 'match_parent' }}
        />
        <TextWidget
          text="TerraBreed"
          style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif', width: 'match_parent' }}
        />
      </FlexWidget>
    );
  }
  