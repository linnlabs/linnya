import { PieChart } from 'echarts/charts';
import { GraphicComponent, LegendComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { echarts } from './echartsCoreRuntime';

echarts.use([GraphicComponent, PieChart, LegendComponent, LabelLayout]);
