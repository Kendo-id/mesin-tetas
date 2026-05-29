import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

interface Props { incubation: any; sensor: any }

export function IncubationWidget({ incubation, sensor }: Props) {
  const day = incubation?.day_number != null
    ? 'Hari ' + incubation.day_number + '/' + (incubation.total_days ?? 21)
    : 'Tidak ada sesi';
  const name = incubation?.species ?? 'TerraBreed';
  const temp = sensor?.temperature != null ? sensor.temperature.toFixed(1) + '\u00B0C' : '--\u00B0C';
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
      <TextWidget text="INKUBASI" style={{ fontSize: 10, color: '#64748B', fontFamily: 'sans-serif' }} />
      <TextWidget text={day} style={{ fontSize: 22, color: '#22C55E', fontFamily: 'sans-serif', fontWeight: 'bold' }} />
      <TextWidget text={name} style={{ fontSize: 12, color: '#E2E8F0', fontFamily: 'sans-serif' }} />
      <TextWidget text={'Suhu: ' + temp + '  Lembab: ' + humid} style={{ fontSize: 10, color: '#64748B', fontFamily: 'sans-serif' }} />
    </FlexWidget>
  );
}
