import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { echarts } from './echartsCoreRuntime'

echarts.use([BarChart, LineChart, GridComponent])
