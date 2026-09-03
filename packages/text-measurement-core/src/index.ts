export { HeuristicMeasureAdapter } from './adapters/HeuristicMeasureAdapter.js';
export {
  DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER,
} from './definitions/types.js';
export type * from './definitions/types.js';
export {
  emuToInches,
  inchesToEmu,
  inchesToPixels,
  inchesToPoints,
  pixelsToInches,
  pointsToInches,
  pointsToPixels,
} from './functions/UnitConverter.js';
export {
  TextMeasureService,
  normalizeClusterAdvanceRequest,
  normalizeTextMeasureInput,
} from './orchestration/TextMeasureService.js';
export { defaultTextMeasureService } from './orchestration/defaultTextMeasureService.js';
