/**
 * Slides Domain 常量
 *
 * 画布默认尺寸、单位转换等，由预览舞台、元素组件、缩放计算共用。
 */

import { resolveSlideSizeInches } from '@plugin/slides/shared/deckSpec';
import { SLIDES_RASTER_LOGICAL_DPI } from '@plugin/slides/shared/slideRasterization';

/** 默认 slide 物理尺寸（英寸，16:9） */
export const DEFAULT_SLIDE_SIZE = resolveSlideSizeInches('16x9');

/** 英寸到像素的转换系数（与 PPTX 原生 DPI 对齐） */
export const INCHES_TO_PX = SLIDES_RASTER_LOGICAL_DPI;

/** 逻辑画布宽度（px，对应 10 英寸 @96dpi） */
export const SLIDE_LOGICAL_WIDTH = DEFAULT_SLIDE_SIZE.width * INCHES_TO_PX;

/** 逻辑画布高度（px，对应 5.625 英寸 @96dpi，即 16:9） */
export const SLIDE_LOGICAL_HEIGHT = DEFAULT_SLIDE_SIZE.height * INCHES_TO_PX;

/** 画布默认宽高比 */
export const SLIDE_ASPECT_RATIO = SLIDE_LOGICAL_WIDTH / SLIDE_LOGICAL_HEIGHT;

/** 缩放范围 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.05;
export const ZOOM_SLIDER_STEP = 0.01;
export const ZOOM_WHEEL_SENSITIVITY = 0.0015;
export const KONVA_RASTER_SETTLE_DELAY_MS = 72;
export const ZOOM_DEFAULT = 1;

/** 缩略图位图使用的设备像素倍率，避免高 DPI 下模糊 */
export const THUMBNAIL_PIXEL_RATIO = typeof window !== 'undefined'
  ? Math.min(window.devicePixelRatio ?? 2, 2)
  : 2;

/** PPT 舞台滚动边界留白（px） */
export const SLIDE_STAGE_SCROLL_GUTTER = 48;

/** 舞台顶部浮动命令条的下沿（top 12px + 条高 36px）。 */
export const SLIDE_STAGE_COMMAND_BAR_BOTTOM = 48;

/** 适应窗口时幻灯片与命令条、底部导航和左右边缘之间统一的可见间距（px）。 */
export const SLIDE_STAGE_FIT_GAP = 32;

/**
 * 适应窗口时的留白（px）。顶部额外让出命令条，使幻灯片到命令条与到底部导航的距离相同；
 * 是否可编辑都按同一留白计算，命令条出现或消失时幻灯片不移动、缩放不变。
 */
export const SLIDE_STAGE_FIT_PADDING = {
  x: SLIDE_STAGE_FIT_GAP,
  top: SLIDE_STAGE_COMMAND_BAR_BOTTOM + SLIDE_STAGE_FIT_GAP,
  bottom: SLIDE_STAGE_FIT_GAP,
} as const;

/**
 * Slides 渲染默认色契约。
 *
 * 中文说明：
 * - 这些颜色会被 Konva / ECharts / render-model 桥接直接消费，不能写 CSS var；
 * - 用户内容、后端 render-model 显式颜色和图表 palette 仍优先生效；
 * - 新增渲染默认色时应先放到这里，避免 mapper / builder / chart 之间漂移。
 */
export const SLIDES_RENDER_COLORS = {
  slideBackground: '#FFFFFF',
  bridgeShapeFill: '#E8E8E8',
  bridgeShapeStroke: '#CCCCCC',
  bridgeTableCellFill: '#F5F5F5',
  fallbackChartSeries: '#B64646',
  chartAxisStroke: '#888888',
  chartGridLine: '#888888',
  chartLabelFill: '#000000',
  chartDataLabelFill: '#000000',
  imagePlaceholderFill: '#F5F5F5',
  imagePlaceholderStroke: '#DDDDDD',
  textFallbackFill: '#333333',
  tableBorderStroke: '#D1D5DB',
  /** 画布上唯一的选择色：选中、悬停、框选、手柄和占位框都用它，标准见 shared/selectionOutline.ts。 */
  selectionStroke: '#347B45',
  selectionMarqueeFill: 'rgba(52, 123, 69, 0.06)',
  /** 吸附参考线；与选择色区分。 */
  manualSnapGuide: '#E8467C',
} as const;
