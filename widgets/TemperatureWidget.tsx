import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

interface Props {
  sensor: {
    temp: number;
    temp_ds1: number;
    temp_ds2: number;
    temp_sht: number;
  } | null;
  history?: number[];
}

export function TemperatureWidget({ sensor }: Props) {
  const temp = sensor?.temp     ?? 0;
  const ds1  = sensor?.temp_ds1 ?? 0;
  const ds2  = sensor?.temp_ds2 ?? 0;
  const sht  = sensor?.temp_sht ?? 0;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#131929',
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 14,
        paddingRight: 14,
      }}
    >
      <TextWidget
        text="Suhu Inkubator"
        style={{ fontSize: 11, color: '#8B9AB3', fontFamily: 'sans-serif' }}
      />
      <FlexWidget
        style={{ flexDirection: 'row', alignItems: 'flex-end' }}
      >
        <TextWidget
          text={temp > 0 ? temp.toFixed(1) : '--'}
          style={{ fontSize: 40, color: '#FFFFFF', fontFamily: 'sans-serif' }}
        />
        <TextWidget
          text={'\u00B0C'}
          style={{ fontSize: 16, color: '#8B9AB3', fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
      <FlexWidget
        style={{ flexDirection: 'row', justifyContent: 'space-between' }}
      >
        <TextWidget
          text={'S1: ' + (ds1 > 0 ? ds1.toFixed(1) : '--') + '\u00B0'}
          style={{ fontSize: 10, color: '#9BAAB9', fontFamily: 'sans-serif' }}
        />
        <TextWidget
          text={'S2: ' + (ds2 > 0 ? ds2.toFixed(1) : '--') + '\u00B0'}
          style={{ fontSize: 10, color: '#9BAAB9', fontFamily: 'sans-serif' }}
        />
        <TextWidget
          text={'SHT: ' + (sht > 0 ? sht.toFixed(1) : '--') + '\u00B0'}
          style={{ fontSize: 10, color: '#9BAAB9', fontFamily: 'sans-serif' }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
