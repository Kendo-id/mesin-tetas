import React from 'react';
  import { FlexWidget, TextWidget } from 'react-native-android-widget';

  interface Props { sensor: any }

  export function TemperatureWidget({ sensor }: Props) {
    const val = sensor?.temperature != null ? sensor.temperature.toFixed(1) + ' C' : '-- C';
    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', alignItems: 'flex_start', backgroundColor: '#0F172A', padding: 14 }}>
        <TextWidget text="Suhu" style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'sans-serif' }} />
        <TextWidget text={val} style={{ fontSize: 40, color: '#F59E0B', fontFamily: 'sans-serif', fontStyle: 'bold' }} />
        <TextWidget text="TerraBreed" style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif' }} />
      </FlexWidget>
    );
  }
  