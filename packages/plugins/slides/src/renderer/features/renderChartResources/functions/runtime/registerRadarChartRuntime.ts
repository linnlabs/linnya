import { RadarChart } from 'echarts/charts';
import { GraphicComponent, LegendComponent, RadarComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { echarts } from './echartsCoreRuntime';

echarts.use([GraphicComponent, RadarChart, RadarComponent, LegendComponent, LabelLayout]);
