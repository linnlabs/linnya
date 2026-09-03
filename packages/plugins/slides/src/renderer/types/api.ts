/**
 * 后端 DTO 类型 re-export
 *
 * 前端统一从这里导入后端定义的类型，避免各处直接引用 src/features 路径。
 */

// ─── DeckPreview（前端预览的核心消费模型）───
export type {
  DeckPreview,
  PreviewSlide,
  PreviewElement,
  PreviewWarning,
  PreviewWarningCode,
} from '@plugin/slides/shared/deckPreview';

// ─── PresentationInfo（inspect 接口返回）───
export type {
  PresentationInfo,
  SlideInfo,
  SlideElementInfo,
  ThemeInfo,
  MasterInfo,
} from '@plugin/slides/shared/presentationInfo';

// ─── SlideSpec 相关（生成/patch 请求体，前端少数场景需要）───
export type {
  Box,
  SourceSpan,
  TextStyle,
  ShapeStyle,
  TableCell,
  StructuredSlideSpec,
  FreeformSlideSpec,
  StructuredElement,
  FreeformElement,
} from '@plugin/slides/shared/deckSpec';
export type {
  ThemeSpec,
} from '@plugin/slides/shared/visual';
export type {
  DeckSpec,
  SlideEntry,
} from '@plugin/slides/shared/deckSpec';

// ─── codegen source slice（点选元素 AI 编辑上下文）───
export type {
  SlidesDocumentBuildState,
  SlidesSourceSliceTargetInput as PptSourceSliceTargetInput,
  SlidesSourceSlicesInput as PptSourceSlicesInput,
  SlidesSourceSliceOutput as PptSourceSliceOutput,
  SlidesSourceSlicesOutput as PptSourceSlicesOutput,
} from '@plugin/slides/shared/documentSource';

// ─── 模板 ───
export type {
  TemplateSpec,
  TemplateSummary,
} from '@plugin/slides/shared/templateSpec';

// ─── 资源引用 ───
export type { AssetRef } from '@plugin/slides/shared/deckSpec';
