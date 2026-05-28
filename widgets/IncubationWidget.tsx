import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

interface IncubationSession {
  active: boolean;
  species?: string;
  total_days?: number;
  total_eggs?: number;
  elapsed_days?: number;
}

interface Props {
  incubation: { incubation?: IncubationSession } | null;
  sensor?: { target_temp?: number; target_humid?: number } | null;
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function IncubationWidget({ incubation, sensor }: Props) {
  const session   = incubation?.incubation;
  const active    = session?.active ?? false;
  const species   = cap(session?.species ?? 'Tidak ada');
  const eggs      = session?.total_eggs  ?? 0;
  const totalDays = session?.total_days  ?? 0;
  const elapsed   = session?.elapsed_days ?? 0;
  const progress  = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0;
  const targetT   = sensor?.target_temp  ?? 37.5;
  const targetH   = sensor?.target_humid ?? 60;

  const rootStyle = {
    height: 'match_parent' as const,
    width:  'match_parent' as const,
    flexDirection: 'column' as const,
    backgroundColor: '#131929',
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 14,
  };

  if (!active) {
    return (
      <FlexWidget style={{ ...rootStyle, justifyContent: 'center', alignItems: 'center' }}>
        <TextWidget
          text="Tidak ada sesi inkubasi aktif"
          style={{ fontSize: 13, color: '#6B7A94', fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
    );
  }

  return (
    <FlexWidget style={{ ...rootStyle, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget
          text="INKUBASI AKTIF"
          style={{ fontSize: 10, color: '#8B9AB3', fontFamily: 'sans-serif' }}
        />
        <TextWidget
          text={progress + '%'}
          style={{ fontSize: 12, color: '#4B9EFF', fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
      <TextWidget
        text={species + (eggs > 0 ? '  ' + eggs + ' butir' : '')}
        style={{ fontSize: 18, color: '#FFFFFF', fontFamily: 'sans-serif' }}
      />
      <TextWidget
        text={'Target: ' + targetT + '\u00B0C  ' + targetH + '% RH  ' + totalDays + ' hari'}
        style={{ fontSize: 10, color: '#8B9AB3', fontFamily: 'sans-serif' }}
      />
      <TextWidget
        text={'Hari ke-' + elapsed + ' dari ' + totalDays}
        style={{ fontSize: 11, color: '#8B9AB3', fontFamily: 'sans-serif' }}
      />
    </FlexWidget>
  );
}
