import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { echarts } from './echartsCoreRuntime';

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  LabelLayout,
]);
