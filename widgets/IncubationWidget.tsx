import React from 'react';
  import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

  interface IncubationSession {
    active: boolean;
    species?: string;
    total_days?: number;
    total_eggs?: number;
    elapsed_days?: number;
    notes?: string;
  }

  interface Props {
    incubation: { incubation?: IncubationSession } | null;
    sensor?: { target_temp?: number; target_humid?: number } | null;
  }

  function capitalize(s: string) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  export function IncubationWidget({ incubation, sensor }: Props) {
    const session  = incubation?.incubation;
    const active   = session?.active ?? false;
    const species  = capitalize(session?.species ?? 'Tidak ada');
    const eggs     = session?.total_eggs ?? 0;
    const totalDays = session?.total_days ?? 0;
    const elapsed  = session?.elapsed_days ?? 0;
    const progress = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0;
    const targetT  = sensor?.target_temp ?? 37.5;
    const targetH  = sensor?.target_humid ?? 60;

    const progressW = Math.round((progress / 100) * 160);

    const ringR = 10;
    const ringCirc = Math.round(2 * Math.PI * ringR);
    const ringDash = Math.round((progress / 100) * ringCirc);
    const ringSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="${ringR}" fill="none" stroke="#1E2A3A" stroke-width="3"/>
      <circle cx="14" cy="14" r="${ringR}" fill="none" stroke="#4B9EFF" stroke-width="3"
        stroke-dasharray="${ringDash} ${ringCirc - ringDash}"
        stroke-linecap="round" transform="rotate(-90 14 14)"/>
    </svg>`;

    if (!active) {
      return (
        <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: '#131929', borderRadius: 20, padding: 14, justifyContent: 'center', alignItems: 'center' }}>
          <TextWidget text="SESI INKUBASI" style={{ fontSize: 10, color: '#8B9AB3' }} />
          <TextWidget text="Tidak ada sesi aktif" style={{ fontSize: 14, color: '#6B7A94', marginTop: 8 }} />
        </FlexWidget>
      );
    }

    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: '#131929', borderRadius: 20, padding: 14 }}>
        <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextWidget text="SESI INKUBASI" style={{ fontSize: 10, color: '#8B9AB3' }} />
          <SvgWidget svg={ringSvg} width={28} height={28} />
        </FlexWidget>
        <TextWidget
          text={species + (eggs > 0 ? ' \u2014 ' + eggs + ' butir' : '')}
          style={{ fontSize: 20, color: '#FFFFFF', fontFamily: 'sans-serif-medium', marginTop: 6 }}
        />
        <TextWidget
          text={"Target: " + targetT + "\u00B0C \u00B7 " + targetH + "% RH \u00B7 " + totalDays + " hari"}
          style={{ fontSize: 11, color: '#8B9AB3', marginTop: 2 }}
        />
        <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <TextWidget
            text={"Hari ke-" + elapsed + " dari " + totalDays}
            style={{ fontSize: 12, color: '#8B9AB3' }}
          />
          <TextWidget
            text={progress + "%"}
            style={{ fontSize: 12, color: '#4B9EFF', fontFamily: 'sans-serif-medium' }}
          />
        </FlexWidget>
        <FlexWidget style={{ width: 'match_parent', height: 4, backgroundColor: '#1E2A3A', borderRadius: 2, marginTop: 6 }}>
          <FlexWidget style={{ width: progressW, height: 4, backgroundColor: '#4B9EFF', borderRadius: 2 }} />
        </FlexWidget>
      </FlexWidget>
    );
  }
  