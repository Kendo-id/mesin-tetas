import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

interface Props { sensor: any }

export function TemperatureWidget({ sensor }: Props) {
  const val = sensor?.temperature != null ? sensor.temperature.toFixed(1) + '\u00B0C' : '--\u00B0C';
  const humid = sensor?.humidity != null ? sensor.humidity.toFixed(0) + '%' : '--%';
  return (
    <FlexWidget style={{
      height: 'match_parent',
      width: 'match_parent',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'center',
      backgroundColor: '#0F172A',
      paddingStart: 14,
      paddingEnd: 14,
    }}>
      <TextWidget text="SUHU" style={{ fontSize: 10, color: '#64748B', fontFamily: 'sans-serif' }} />
      <TextWidget text={val} style={{ fontSize: 38, color: '#F59E0B', fontFamily: 'sans-serif', fontWeight: 'bold' }} />
      <TextWidget text={'Lembab: ' + humid} style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'sans-serif' }} />
      <TextWidget text="TerraBreed" style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif' }} />
    </FlexWidget>
  );
}
