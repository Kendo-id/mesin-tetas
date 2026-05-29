import React from 'react';
  import { FlexWidget, TextWidget } from 'react-native-android-widget';

  interface Props { session: any }

  export function IncubationWidget({ session }: Props) {
    const day = session?.day_number != null ? 'Hari ' + session.day_number + '/' + (session.total_days ?? 21) : 'Tidak ada sesi';
    const name = session?.name ?? 'TerraBreed';
    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', alignItems: 'flex_start', backgroundColor: '#0F172A', padding: 14 }}>
        <TextWidget text="Inkubasi" style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'sans-serif' }} />
        <TextWidget text={day} style={{ fontSize: 22, color: '#22C55E', fontFamily: 'sans-serif', fontStyle: 'bold' }} />
        <TextWidget text={name} style={{ fontSize: 12, color: '#E2E8F0', fontFamily: 'sans-serif' }} />
      </FlexWidget>
    );
  }
  