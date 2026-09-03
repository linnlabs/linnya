/**
 * flex-layout 模块入口
 *
 * Flex 布局编译器：将 AI 通过场景图 DSL 生成的布局树编译为绝对坐标的 DirectComposeInput。
 */

export { compileFlexInput, compileSlide } from './FlexLayoutCompiler.js';
export type { FlexCompileResult, RejectedSlide } from './FlexLayoutCompiler.js';
export { computeSlideLayout, initYoga } from './YogaAdapter.js';
export type { ComputedBox, LayoutResult } from './YogaAdapter.js';
export { estimateTextHeight } from './TextMeasurer.js';
export { readYogaRuntimeLoader } from './YogaRuntimeLoaderResolver.js';
export type {
  CjsRequire,
  CreateRequireFactory,
  YogaRuntimeLoaderModule,
} from './YogaRuntimeLoaderResolver.js';
export { isFlexComposeInput } from './LayoutTypes.js';
export { LAYOUT_PRIMITIVES_SOURCE } from './LayoutPrimitives.js';
export { buildDeckDesignAnchor, serializeDeckDesignAnchor, emptyDeckDesignAnchor } from './deckDesignAnchor.js';
export type { DeckDesignAnchor, SerializedDeckDesignAnchor } from './deckDesignAnchor.js';

export type {
  FlexComposeInput,
  FlexProps,
  LayoutBorderInput,
  LayoutChartConfig,
  LayoutChartDataLike,
  LayoutChartLegendPosition,
  LayoutChartPresetName,
  LayoutChartSeriesInput,
  LayoutChartType,
  LayoutNode,
  LayoutSlideNode,
  LayoutSlideConfig,
  LayoutContainerNode,
  LayoutLeafNode,
  LayoutViewNode,
  LayoutViewConfig,
  LayoutTextNode,
  LayoutTextConfig,
  LayoutTextRun,
  LayoutTextStyleInput,
  LayoutShapeNode,
  LayoutShapeConfig,
  LayoutChartNode,
  LayoutTableNode,
  LayoutTableCellInput,
  LayoutTableCellValue,
  LayoutTableConfig,
  LayoutTableDataLike,
  LayoutImageNode,
  LayoutImageConfig,
  LayoutImageSourceInput,
  LayoutImageVisualShadowInput,
  LayoutSpacerNode,
  LayoutSpacerConfig,
  LayoutThemeInput,
  // 向后兼容别名（deprecated）
  LayoutVStackNode,
  LayoutHStackNode,
} from './LayoutTypes.js';
