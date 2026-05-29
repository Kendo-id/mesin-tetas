import React from 'react';
import type { WidgetTaskHandler } from 'react-native-android-widget';
import { TemperatureWidget } from './TemperatureWidget';
import { HumidityWidget } from './HumidityWidget';
import { IncubationWidget } from './IncubationWidget';

const widgetTaskHandler: WidgetTaskHandler = async ({
  widgetInfo,
  widgetAction,
  renderWidget,
}) => {
  if (widgetAction === 'WIDGET_DELETED') return;

  const name = widgetInfo.widgetName as string;

  if (name === 'TemperatureWidget') {
    renderWidget(<TemperatureWidget sensor={null} />);
  } else if (name === 'HumidityWidget') {
    renderWidget(<HumidityWidget sensor={null} />);
  } else if (name === 'IncubationWidget') {
    renderWidget(<IncubationWidget incubation={null} sensor={null} />);
  }
};

export { widgetTaskHandler };
export default widgetTaskHandler;
