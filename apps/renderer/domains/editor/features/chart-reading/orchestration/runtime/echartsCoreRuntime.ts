import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { AriaComponent, TooltipComponent } from 'echarts/components'
import { LabelLayout } from 'echarts/features'

// 正文使用 SVG：文字可选、缩放清晰、节点量与数据点成正比，且无需 Canvas 的像素比处理。
echarts.use([SVGRenderer, AriaComponent, TooltipComponent, LabelLayout])

export { echarts }
