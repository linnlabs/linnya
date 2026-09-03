import { PieChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { echarts } from './echartsCoreRuntime';

echarts.use([PieChart, LegendComponent, LabelLayout]);
