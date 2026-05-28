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

  function progressBar(current: number, total: number) {
    const pct = Math.min(Math.max(current / total, 0), 1);
    const bars = 12;
    const filled = Math.round(pct * bars);
    let s = '';
    for (let i = 0; i < bars; i++) s += i < filled ? '█' : '░';
    return s;
  }

  export function IncubationWidget({ session }: Props) {
    const isActive = session != null && session.status !== 'completed' && session.day_number != null;
    const isOffline = session == null;

    const dayNum = session?.day_number ?? 0;
    const totalDays = session?.total_days ?? 21;
    const name = session?.name ?? 'Tidak ada sesi';
    const animal = session?.animal ?? '';
    const eggs = session?.total_eggs ?? 0;
    const pct = totalDays > 0 ? Math.round((dayNum / totalDays) * 100) : 0;
    const bar = isActive ? progressBar(dayNum, totalDays) : '';
    const dotColor = isOffline ? '#6B7280' : isActive ? '#22C55E' : '#6B7280';

    return (
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0F172A',
          borderRadius: 16,
          padding: 14,
        }}
      >
        {/* Header row */}
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <TextWidget
            text="🥚 INKUBASI"
            style={{
              fontSize: 11,
              fontFamily: 'sans-serif-medium',
              color: '#94A3B8',
            }}
          />
          <FlexWidget
            style={{
              backgroundColor: dotColor + '22',
              borderRadius: 20,
              padding: 4,
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <TextWidget
              text={isOffline ? '● Offline' : isActive ? '● Aktif' : '● Tidak Aktif'}
              style={{
                fontSize: 9,
                color: dotColor,
                fontFamily: 'sans-serif-medium',
              }}
            />
          </FlexWidget>
        </FlexWidget>

        {/* Session name */}
        <TextWidget
          text={isOffline ? 'Memuat data...' : name}
          style={{
            fontSize: 15,
            fontFamily: 'sans-serif-medium',
            color: isOffline ? '#4B5563' : '#E2E8F0',
            width: 'match_parent',
          }}
        />

        {/* Progress if active */}
        {isActive && (
          <FlexWidget
            style={{
              width: 'match_parent',
              flexDirection: 'column',
            }}
          >
            <FlexWidget
              style={{
                width: 'match_parent',
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <TextWidget
                text={'Hari ' + dayNum + '/' + totalDays}
                style={{ fontSize: 12, color: '#F59E0B', fontFamily: 'sans-serif-medium' }}
              />
              <TextWidget
                text={pct + '%'}
                style={{ fontSize: 12, color: '#F59E0B', fontFamily: 'sans-serif-medium' }}
              />
            </FlexWidget>
            <TextWidget
              text={bar}
              style={{
                fontSize: 10,
                color: '#F59E0B',
                fontFamily: 'monospace',
                width: 'match_parent',
              }}
            />
          </FlexWidget>
        )}

        {/* Footer */}
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <TextWidget
            text="TerraBreed"
            style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif' }}
          />
          {isActive && eggs > 0 && (
            <TextWidget
              text={animal + ' · ' + eggs + ' telur'}
              style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif' }}
            />
          )}
        </FlexWidget>
      </FlexWidget>
    );
  }
  