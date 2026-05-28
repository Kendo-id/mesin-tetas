import React from 'react';
  import { FlexWidget, TextWidget, ImageWidget } from 'react-native-android-widget';

  interface SensorData {
    temperature?: number | null;
    humidity?: number | null;
    updated_at?: string | null;
  }

  interface Props {
    sensor: SensorData | null;
  }

  export function TemperatureWidget({ sensor }: Props) {
    const temp = sensor?.temperature != null ? sensor.temperature.toFixed(1) : '--';
    const isOffline = sensor == null || sensor.temperature == null;
    const statusColor = isOffline ? '#6B7280' : '#F59E0B';
    const tempNum = sensor?.temperature ?? 0;
    const alert = !isOffline && (tempNum < 35 || tempNum > 38.5);
    const dotColor = alert ? '#EF4444' : isOffline ? '#6B7280' : '#22C55E';

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
            text="🌡️ SUHU"
            style={{
              fontSize: 11,
              fontFamily: 'sans-serif-medium',
              color: '#94A3B8',
            }}
          />
          <FlexWidget
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: dotColor + '22',
              borderRadius: 20,
              padding: 4,
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <TextWidget
              text={isOffline ? '● Offline' : alert ? '● Peringatan' : '● Live'}
              style={{
                fontSize: 9,
                color: dotColor,
                fontFamily: 'sans-serif-medium',
              }}
            />
          </FlexWidget>
        </FlexWidget>

        {/* Main value */}
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            alignItems: 'flex-end',
          }}
        >
          <TextWidget
            text={temp}
            style={{
              fontSize: 42,
              fontFamily: 'sans-serif-black',
              color: isOffline ? '#4B5563' : statusColor,
              includeFontPadding: false,
            }}
          />
          <TextWidget
            text="°C"
            style={{
              fontSize: 18,
              fontFamily: 'sans-serif-medium',
              color: isOffline ? '#374151' : statusColor,
              marginLeft: 2,
              marginBottom: 6,
            }}
          />
        </FlexWidget>

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
          <TextWidget
            text="Ideal 37–38°C"
            style={{ fontSize: 10, color: '#334155', fontFamily: 'sans-serif' }}
          />
        </FlexWidget>
      </FlexWidget>
    );
  }
  