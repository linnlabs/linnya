import type { RenderChartType } from '../../../../types/render';

let cartesianRuntime: Promise<unknown> | null = null;
let pieRuntime: Promise<unknown> | null = null;
let radarRuntime: Promise<unknown> | null = null;

/** 按图表家族延迟注册 ECharts 模块，避免 Slides 页面未打开时加载整套图表运行时。 */
export async function loadEChartsRuntime(
  chartType: RenderChartType,
): Promise<(typeof import('./echartsCoreRuntime'))['echarts']> {
  const core = await import('./echartsCoreRuntime');

  switch (chartType) {
    case 'pie':
    case 'doughnut':
      pieRuntime ??= import('./registerPieChartRuntime');
      await pieRuntime;
      break;
    case 'radar':
      radarRuntime ??= import('./registerRadarChartRuntime');
      await radarRuntime;
      break;
    default:
      cartesianRuntime ??= import('./registerCartesianChartRuntime');
      await cartesianRuntime;
      break;
  }

  return core.echarts;
}
