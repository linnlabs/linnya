import { randomUUID } from 'node:crypto';
import type {
  DeckPreview,
  DeckSpec,
  FreeformSlideSpec,
  ImageSourceInput,
  ImageSourceRef,
  PatchSpec,
  PresentationInfo,
  PresentationRenderModel,
  PresentationSourceKind,
  SpatialAnalysisSummary,
  SpatialNode,
  SvgGraphicOwnedAssetRef,
  SvgGraphicResolvedAsset,
  StructuredSlideSpec,
  TemplateSpec,
  TemplateSummary,
  ThemeSpec,
} from '@plugin/slides/shared';
import type { PptxPaintCompileContext } from './visual/pptxPaintPatchPlan';
import type { FormulaPptxCompileContext } from './mathFormula/pptx/formulaPptxPlan';
import type { ChartPptxContext } from './chart/chartPptx';

export interface SlidesAssetResolveContext {
  readonly documentId?: string;
  readonly projectId?: string;
  readonly conversationId?: string;
}

export interface ImageSourceResolveContext extends SlidesAssetResolveContext {
  /** 由布局完成后的图片盒派生；只有需要生成像素资产的来源消费。 */
  readonly targetSizeInches?: {
    readonly width: number;
    readonly height: number;
  };
}

export interface DeckAssembleOptions {
  readonly assetContext?: SlidesAssetResolveContext;
}

/** 单次 PPTX 编译的 SVG 内容表；只由 DeckAssembler 构造并向编译器下发。 */
export interface SvgGraphicCompileContext {
  readonly assets: ReadonlyMap<string, SvgGraphicResolvedAsset>;
  /** 编译器按绘制顺序领取当前 SVG picture 的稳定对象名。 */
  nextPlacement(assetId: string): SvgGraphicPptxPlacement;
}

export interface SvgGraphicPptxPlacement {
  readonly objectName: string;
}

export interface SvgGraphicFallbackRasterizeInput {
  readonly canonicalSvg: string;
  readonly contentHash: string;
  readonly viewBox: SvgGraphicResolvedAsset['viewBox'];
}

export interface SvgGraphicFallbackRasterizedAsset {
  readonly pngBytes: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** engine 只依赖透明 SVG -> PNG 能力；具体 hidden worker 属于 app adapter。 */
export interface SvgGraphicFallbackRasterizerPort {
  rasterizeSvgGraphic(
    input: SvgGraphicFallbackRasterizeInput
  ): Promise<SvgGraphicFallbackRasterizedAsset>;
}

export interface ExportedPresentationFile {
  readonly buffer: Buffer;
  readonly fileName: string;
}

export interface DeckAssemblerPort {
  assemble(deckSpec: DeckSpec, options?: DeckAssembleOptions): Promise<Buffer>;
}

export interface StructuredCompilerPort {
  compileSlide(
    pptx: unknown,
    spec: StructuredSlideSpec,
    theme?: ThemeSpec,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext,
    chartContext?: ChartPptxContext,
  ): void;
  compileDeck(deckSpec: DeckSpec): Promise<Buffer>;
}

export interface FreeformCompilerPort {
  compileSlide(
    pptx: unknown,
    spec: FreeformSlideSpec,
    theme?: ThemeSpec,
    paintContext?: PptxPaintCompileContext,
    svgGraphicContext?: SvgGraphicCompileContext,
    formulaContext?: FormulaPptxCompileContext
  ): void;
  compileDeck?(deckSpec: DeckSpec): Promise<Buffer>;
}

export interface PatchCompilerPort {
  compile(sourcePptxBuffer: Buffer, patchSpec: PatchSpec): Promise<Buffer>;
}

export interface PptxReaderPort {
  parse(buffer: Buffer): Promise<PresentationInfo>;
}

export interface TemplateManagerPort {
  getTemplate?(templateId: string): Promise<{
    readonly sourcePptxBuffer?: Buffer;
  } | null>;
}

export interface TemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly spec: TemplateSpec;
  readonly sourcePptxBuffer: Buffer;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly usageCount: number;
}

export interface TemplateRepositoryPort {
  saveTemplate(template: TemplateSpec, sourcePptxBuffer: Buffer): Promise<string>;
  getTemplate(templateId: string): Promise<TemplateRecord | null>;
  listTemplates(): Promise<TemplateSummary[]>;
}

/**
 * 图片来源解析 port。
 *
 * 这是 engine adapter 与当前 in-process 实现之间的窄契约，归属于
 * `backend-engine`。它只描述“把 Slides 图片引用解析为已授权图片内容”的能力，
 * 不暴露 workspace / DB / asset service 实现，避免未来引擎进程化时重新拆边界。
 */
export interface ImageSourceResolverPort {
  /** 将 authoring source 解析成 engine 可消费且不依赖原始外部位置的图片内容。 */
  resolveImageSource(
    source: ImageSourceRef,
    context?: ImageSourceResolveContext
  ): Promise<ImageSourceRef>;
}

/** 读取已经属于当前演示文稿的 SVG Graphic；不负责接管任意作者来源。 */
export interface SvgGraphicAssetResolverPort {
  resolveSvgGraphicAsset(
    ref: SvgGraphicOwnedAssetRef,
    context?: SlidesAssetResolveContext
  ): Promise<SvgGraphicResolvedAsset>;
}

export interface SlidesEngineLogger {
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface SlidesPresentationQueryPort {
  inspect(
    version: SlidesEngineVersionSnapshot,
    assembleOptions?: DeckAssembleOptions
  ): Promise<PresentationInfo>;
  export(
    version: SlidesEngineVersionSnapshot,
    assembleOptions?: DeckAssembleOptions
  ): Promise<ExportedPresentationFile>;
  getPreview(
    nodeId: string,
    version: SlidesEngineVersionSnapshot,
    assembleOptions?: DeckAssembleOptions
  ): Promise<DeckPreview>;
  getRenderModel(
    nodeId: string,
    version: SlidesEngineVersionSnapshot,
    assembleOptions?: DeckAssembleOptions,
    options?: SlidesEngineRenderModelOptions
  ): Promise<PresentationRenderModel>;
}

export interface SlidesEngineRenderModelOptions {
  /**
   * 只有 coordinator 已确认 DeckSpec 中的 sourceSpan 可用时才开启。
   * deckSource 存在只代表历史源码仍在，不能直接代表前端可定位编辑。
   */
  readonly canEditSourceSelection?: boolean;
}

export type SlidesEngineOperationName =
  | 'assembleDeck'
  | 'parsePptx'
  | 'compilePatch'
  | 'analyzeSpatial'
  | 'resolvePatchImageSource'
  | 'inspectPresentation'
  | 'exportPresentation'
  | 'buildPreview'
  | 'buildRenderModel';

export interface SlidesEngineExecutionScope {
  readonly nodeId?: string;
  readonly versionId?: string;
  readonly projectId?: string;
  readonly traceId?: string;
}

/**
 * Slides 引擎执行上下文必须是可序列化 DTO。
 * 现在的 in-process adapter 只用它做可观测日志；未来换 utilityProcess / worker
 * 时，这个对象可以原样穿过进程边界。
 */
export interface SlidesEngineExecutionContext extends SlidesEngineExecutionScope {
  readonly pluginId: 'slides';
  readonly operation: SlidesEngineOperationName;
  readonly jobId: string;
  readonly traceId: string;
}

export interface SlidesEngineAssembleDeckRequest {
  readonly deckSpec: DeckSpec;
  readonly assembleOptions?: DeckAssembleOptions;
  readonly context: SlidesEngineExecutionContext;
}

export interface SlidesEngineParsePptxRequest {
  readonly buffer: Buffer;
  readonly context: SlidesEngineExecutionContext;
}

export interface SlidesEngineResolvePatchImageSourceRequest {
  readonly source: ImageSourceInput;
  readonly context: SlidesEngineExecutionContext;
}

export interface SlidesEngineCompilePatchRequest {
  readonly sourcePptxBuffer: Buffer;
  readonly patchSpec: PatchSpec;
  readonly context: SlidesEngineExecutionContext;
}

export interface SlidesEngineAnalyzeSpatialRequest {
  readonly slideNodes: readonly SpatialNode[];
  readonly context: SlidesEngineExecutionContext;
}

export type SlidesEnginePresentationSourceKind = PresentationSourceKind;

/**
 * Engine 只需要“可执行版本快照”，不应依赖 repository record 类型。
 * 这样后续 repository / storage 迁移不会污染 engine adapter 契约。
 */
export interface SlidesEngineVersionSnapshot {
  readonly id: string;
  readonly nodeId: string;
  readonly versionNumber: number;
  readonly deckSpec: DeckSpec;
  readonly pptxBuffer: Buffer;
  readonly sourceKind: SlidesEnginePresentationSourceKind;
  readonly deckSource?: string;
  readonly title: string;
}

export interface SlidesEngineVersionRequest {
  readonly nodeId: string;
  readonly version: SlidesEngineVersionSnapshot;
  readonly assembleOptions?: DeckAssembleOptions;
  readonly context: SlidesEngineExecutionContext;
  readonly renderModelOptions?: SlidesEngineRenderModelOptions;
}

export interface SlidesEngineExecutionAdapter {
  assembleDeck(request: SlidesEngineAssembleDeckRequest): Promise<Buffer>;
  parsePptx(request: SlidesEngineParsePptxRequest): Promise<PresentationInfo>;
  compilePatch(request: SlidesEngineCompilePatchRequest): Promise<Buffer>;
  analyzeSpatial(request: SlidesEngineAnalyzeSpatialRequest): Promise<SpatialAnalysisSummary>;
  resolvePatchImageSource(request: SlidesEngineResolvePatchImageSourceRequest): Promise<string>;
  inspectPresentation(request: SlidesEngineVersionRequest): Promise<PresentationInfo>;
  exportPresentation(request: SlidesEngineVersionRequest): Promise<ExportedPresentationFile>;
  buildPreview(request: SlidesEngineVersionRequest): Promise<DeckPreview>;
  buildRenderModel(request: SlidesEngineVersionRequest): Promise<PresentationRenderModel>;
}

export function createSlidesEngineExecutionContext(
  operation: SlidesEngineOperationName,
  scope: SlidesEngineExecutionScope = {}
): SlidesEngineExecutionContext {
  const runId = randomUUID();
  return {
    pluginId: 'slides',
    operation,
    jobId: `slides:${operation}:${runId}`,
    traceId: scope.traceId ?? runId,
    ...(scope.nodeId ? { nodeId: scope.nodeId } : {}),
    ...(scope.versionId ? { versionId: scope.versionId } : {}),
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
  };
}
