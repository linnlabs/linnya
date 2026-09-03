export { CodegenDeckBuilder } from './CodegenDeckBuilder';
export { createBlankPresentationSource } from './createBlankPresentationSource';
export {
  canCreateInitialDraftForFailure,
  InitialPresentationDraftCreator,
} from './InitialPresentationDraftCreator';
export type { InitialPresentationDraftCreatorDeps } from './InitialPresentationDraftCreator';
export type {
  CodegenDeckBuildInput,
  CodegenDeckBuildResult,
  CodegenDeckBuilderFailureLogger,
  CodegenDeckBuilderDeps,
  CodegenDeckCreateInput,
  CodegenDeckCreateOptions,
  CodegenDeckCreateResult,
  CodegenDeckExpectedBase,
  CodegenSandboxExecutor,
  CodegenWorkspacePresentationPort,
} from './CodegenDeckBuilder';
export type {
  CodegenDiagnostic,
  ParseCodegenDiagnostic,
  StructureCodegenDiagnostic,
  StructureCodegenDiagnosticCode,
} from './writeDiagnostics';
export { isContainerNode, isFlexComposeInput, isLeafNode } from '@plugin/slides/shared';
export {
  buildChartOptionsFromParams,
  CHART_PRESET_NAMES,
  CHART_PRESETS,
  resolveChartPreset,
} from './compose/chartPresets';
export type { ChartPreset, ChartPresetName } from './compose/chartPresets';
export {
  buildDeckSpecFromDirectInput,
  readDirectComposeInput,
} from './compose/presentationComposeInput';
export type {
  DirectComposeInput,
  DirectElementInput,
  DirectSlideInput,
} from './compose/presentationComposeInput';
export {
  createParseContext,
  dedupeParseWarnings,
  formatParseWarnings,
  pushParseWarning,
} from './compose/inputParsers/parseContext';
export type {
  DedupeOptions,
  ParseContext,
  ParseWarning,
  ParseWarningInput,
  ParseWarningSeverity,
} from './compose/inputParsers/parseContext';
export {
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  parseDisplayString,
  parseLabelArray,
  parseStringArray,
  parseStringMatrix,
} from './compose/inputParsers/typeGuards';
export {
  KNOWN_SHAPE_STYLE_KEYS,
  KNOWN_TEXT_STYLE_KEYS,
  parseImageVisualShadow,
  parsePartialBox,
  parseShapeStyle,
  parseTextStyle,
  readThemeSpecInput,
  splitElementStyleInput,
} from './compose/inputParsers/styleParsers';
export type { ElementStyleSplit, ThemeInput } from './compose/inputParsers/styleParsers';
export {
  parseChartDataLike,
  parseChartSeries,
  parseChartSeriesArray,
  parseChartType,
  parseImageSourceInput,
  parseTableCell,
  parseTableDataLike,
  parseTableRows,
} from './compose/inputParsers/dataParsers';
export type {
  ChartDataParseOptions,
  NormalizedChartData,
  NormalizedTableData,
} from './compose/inputParsers/dataParsers';
export {
  buildDeckDesignAnchor,
  compileFlexInput,
  compileSlide,
  computeSlideLayout,
  emptyDeckDesignAnchor,
  estimateTextHeight,
  initYoga,
  LAYOUT_PRIMITIVES_SOURCE,
  readYogaRuntimeLoader,
  serializeDeckDesignAnchor,
} from './compose/flex-layout';
export type {
  ComputedBox,
  CjsRequire,
  CreateRequireFactory,
  DeckDesignAnchor,
  FlexCompileResult,
  LayoutSlideNode,
  LayoutResult,
  RejectedSlide,
  SerializedDeckDesignAnchor,
  YogaRuntimeLoaderModule,
} from './compose/flex-layout';
export { DECK_NOT_CODEGEN_READY, DeckSourceStore, DeckSourceStoreError } from './DeckSourceStore';
export type { DeckSourceReadResult, DeckSourceStoreErrorCode } from './DeckSourceStore';
export { CodegenPresentationError, CodegenPresentationService } from './CodegenPresentationService';
export type {
  CodegenPresentationBuilderPort,
  CodegenInitialDraftCreatorPort,
  CodegenPresentationServiceDeps,
  CodegenToolContext,
  CodegenWriteContext,
  PptEditInput,
  PptEditOutput,
  PptGrepInput,
  PptGrepOutput,
  PptReadInput,
  PptReadOutput,
  PptSourceSliceOutput,
  PptSourceSliceTargetInput,
  PptSourceSlicesInput,
  PptSourceSlicesOutput,
  PptStructureInput,
  PptStructureOutput,
  PptWriteInput,
  PptWriteOutput,
} from './CodegenPresentationService';
export { DeckReadStateRegistry } from './DeckReadStateRegistry';
export type { DeckReadEntry } from './DeckReadStateRegistry';
export {
  createPresentationBuildFailure,
  formatPresentationWriteFailure,
  PresentationBuildFailureError,
} from '../features/presentationBuildFailure';
export type {
  PresentationBuildFailure,
  PresentationBuildFailureCode,
  PresentationBuildFailurePhase,
  PresentationExpectedRevision,
  PresentationTypecheckDiagnostic,
  PresentationWriteFailure,
} from '../features/presentationBuildFailure';
export { addLineNumbers, buildStructuredPatch } from './diff/formatPatch';
export type { StructuredPatchHunk, StructuredPatchLine } from './diff/formatPatch';
