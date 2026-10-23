import type { MarkdownChartSpec } from '@app/schemas'
import { useLocalizationStore } from '@app/localization'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import { baseChartTheme } from '../definitions/chartTheme'
import { renderChartImageSvg } from './exportChartImage'

/** 打印使用白纸上的完整默认视图，不继承界面的暗色主题或会话筛选。 */
export function renderChartPrintImage(spec: MarkdownChartSpec) {
  return renderChartImageSvg({
    spec,
    theme: baseChartTheme('light', spec.palette),
    locale: useLocalizationStore().currentLocale,
    messages: {
      secondaryAxis: resolveCurrentEditorMessage('editor.chart.legend.secondaryAxis'),
      shareOfWhole: resolveCurrentEditorMessage('editor.chart.message.shareOfWhole'),
      share: resolveCurrentEditorMessage('editor.chart.message.share'),
    },
    ...(spec.chartType === 'radar' && spec.radarScale
      ? { footnote: resolveCurrentEditorMessage('editor.chart.radar.scale', { max: spec.radarScale.max }) }
      : {}),
  })
}
