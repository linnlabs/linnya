import { RadarChart } from 'echarts/charts';
import { LegendComponent, RadarComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { echarts } from './echartsCoreRuntime';

echarts.use([RadarChart, RadarComponent, LegendComponent, LabelLayout]);
