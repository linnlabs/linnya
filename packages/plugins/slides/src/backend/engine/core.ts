export {
  DeckAssembler,
} from './DeckAssembler';
export {
  FreeformCompiler,
} from './FreeformCompiler';
export {
  StructuredCompiler,
} from './StructuredCompiler';
export {
  PatchCompiler,
} from './patch/PatchCompiler';
export {
  PptxReader,
} from './parser/PptxReader';
export {
  TemplateManager,
} from './template/TemplateManager';
export {
  InProcessSlidesEngineExecutionAdapter,
} from './execution/InProcessSlidesEngineExecutionAdapter';
export {
  admitSvgGraphic,
  SvgGraphicMaterializationError,
} from './svgGraphic';
export type {
  SvgGraphicMaterializationErrorCode,
} from './svgGraphic';
export type {
  InProcessSlidesEngineExecutionAdapterDeps,
} from './execution/InProcessSlidesEngineExecutionAdapter';
export {
  DeckSpecPatchApplier,
} from './coordinator/DeckSpecPatchApplier';
export {
  PptPresentationQueryService,
} from './coordinator/PptPresentationQueryService';
export {
  assertDeckSpecGenerationValid,
} from './coordinator/DeckSpecGenerationValidator';
export {
  buildInitialPresentationDeck,
} from './deck/defaultDeck';
export {
  createSlidesEngineExecutionContext,
} from './types';
export {
  BRUSH_ARTWORK_ADAPTER_VERSION,
  BRUSH_ARTWORK_UPSTREAM_COMMIT,
  createBrushArtworkMaterializationIdentity,
} from './brushArtwork';
export type {
  BrushArtworkGeneratedAsset,
  BrushArtworkGeneratorPort,
} from './brushArtwork';
export type {
  DeckAssembleOptions,
  DeckAssemblerPort,
  ExportedPresentationFile,
  FreeformCompilerPort,
  ImageSourceResolveContext,
  ImageSourceResolverPort,
  SlidesAssetResolveContext,
  PatchCompilerPort,
  PptxReaderPort,
  SlidesEngineAssembleDeckRequest,
  SlidesEngineCompilePatchRequest,
  SlidesEngineExecutionAdapter,
  SlidesEngineExecutionContext,
  SlidesEngineExecutionScope,
  SlidesEngineLogger,
  SlidesEngineOperationName,
  SlidesEngineParsePptxRequest,
  SlidesEnginePresentationSourceKind,
  SlidesEngineVersionRequest,
  SlidesEngineVersionSnapshot,
  SlidesPresentationQueryPort,
  SvgGraphicAssetResolverPort,
  SvgGraphicCompileContext,
  SvgGraphicFallbackRasterizeInput,
  SvgGraphicFallbackRasterizedAsset,
  SvgGraphicFallbackRasterizerPort,
  SvgGraphicPptxPlacement,
} from './types';
