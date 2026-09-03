export {
  TextMeasureService,
  normalizeClusterAdvanceRequest,
  normalizeTextMeasureInput,
} from './orchestration/TextMeasureService.js';
export {
  DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER,
} from './definitions/types.js';
export {
  configureDefaultTextMeasureService,
  defaultTextMeasureService,
  resetDefaultTextMeasureService,
  resetDefaultTextMeasureServiceForTests,
} from './orchestration/defaultTextMeasureService.js';
export { HeuristicMeasureAdapter } from './adapters/HeuristicMeasureAdapter.js';
export {
  createSystemTextMeasurementRuntime,
} from './infrastructure/system/createSystemTextMeasurementRuntime.js';
export type {
  SystemTextMeasurementRuntime,
} from './infrastructure/system/createSystemTextMeasurementRuntime.js';
export {
  buildCanvasFontShorthand,
  resolveFontFamily,
} from './functions/FontResolver.js';
export {
  emuToInches,
  inchesToEmu,
  inchesToPixels,
  inchesToPoints,
  pixelsToInches,
  pointsToInches,
  pointsToPixels,
} from './functions/UnitConverter.js';
export type {
  ClusterAdvanceMeasureResult,
  ClusterAdvanceRequest,
  FontFileLocator,
  NormalizedClusterAdvanceRequest,
  NormalizedTextMeasureInput,
  ResolvedFontFile,
  TextMeasureAdvanceSource,
  TextMeasureAdapter,
  TextMeasureBox,
  TextMeasureClusterAdvanceProvider,
  TextMeasureFitOptions,
  TextMeasureFitResult,
  TextMeasureInput,
  TextMeasureLine,
  TextMeasurePadding,
  TextMeasureParagraph,
  TextMeasureResult,
  TextMeasureSourceKind,
  TextMeasureStyle,
  TextMeasureWrapMode,
} from './definitions/types.js';
