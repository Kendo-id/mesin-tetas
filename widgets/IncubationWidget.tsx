import React from 'react';
  import { FlexWidget, TextWidget } from 'react-native-android-widget';

  interface Session {
    name?: string | null;
    animal?: string | null;
    total_eggs?: number | null;
    day_number?: number | null;
    total_days?: number | null;
    status?: string | null;
  }

  interface Props {
    session: Session | null;
  }

  export function IncubationWidget({ session }: Props) {
    const isOffline = session == null;
    const isActive = !isOffline && session.status !== 'completed' && session.day_number != null;
    const name = session?.name ?? 'Tidak ada sesi aktif';
    const dayNum = session?.day_number ?? 0;
    const totalDays = session?.total_days ?? 21;
    const eggs = session?.total_eggs ?? 0;
    const animal = session?.animal ?? '';
    const pct = totalDays > 0 ? Math.round((dayNum / totalDays) * 100) : 0;
    const progressText = isActive ? ('Hari ' + dayNum + '/' + totalDays + ' (' + pct + '%)') : 'Tidak ada sesi aktif';
    const statusText = isOffline ? 'Offline' : isActive ? 'Aktif' : 'Selesai';
    const statusColor = isOffline ? '#6B7280' : isActive ? '#22C55E' : '#6B7280';
    const infoText = isActive ? (animal + ' - ' + eggs + ' telur') : 'TerraBreed';

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
          text={'Inkubasi: ' + statusText}
          style={{ fontSize: 12, color: statusColor, fontFamily: 'sans-serif', width: 'match_parent' }}
        />
        <TextWidget
          text={isOffline ? 'Memuat data...' : name}
          style={{ fontSize: 16, color: '#E2E8F0', fontFamily: 'sans-serif', fontStyle: 'bold', width: 'match_parent' }}
        />
        <TextWidget
          text={progressText}
          style={{ fontSize: 12, color: '#F59E0B', fontFamily: 'sans-serif', width: 'match_parent' }}
        />
        <TextWidget
          text={infoText}
          style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif', width: 'match_parent' }}
        />
      </FlexWidget>
    );
  }
  