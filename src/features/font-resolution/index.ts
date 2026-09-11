export {
  parseFontFileMetadata,
  parseFontMetadata,
} from './functions/parseFontMetadata.js';
export {
  FontCatalog,
} from './orchestration/FontCatalog.js';
export type {
  FontCatalogOptions,
} from './orchestration/FontCatalog.js';
export {
  FontCatalogQueryService,
} from './orchestration/FontCatalogQueryService.js';
export type {
  FontCatalogQueryPort,
} from './orchestration/FontCatalogQueryService.js';
export {
  createSystemFontCatalogQueryRuntime,
} from './orchestration/createSystemFontCatalogQueryRuntime.js';
export type {
  SystemFontCatalogQueryRuntime,
} from './orchestration/createSystemFontCatalogQueryRuntime.js';
export {
  createSystemFontResolutionRuntime,
} from './orchestration/createSystemFontResolutionRuntime.js';
export type {
  SystemFontResolutionRuntime,
} from './orchestration/createSystemFontResolutionRuntime.js';
export {
  checkFontFamily,
  configureDefaultFontCatalogQueryService,
  defaultFontCatalogQueryService,
  listFontFamilies,
  resetDefaultFontCatalogQueryService,
} from './orchestration/defaultFontCatalogQueryService.js';
export {
  FontResolutionService,
} from './orchestration/FontResolutionService.js';
export type {
  FontResolutionCatalog,
  FontResolutionServiceOptions,
  FontSubstitutionScorer,
} from './orchestration/FontResolutionService.js';
export {
  configureDefaultFontResolutionService,
  defaultFontResolutionService,
  resetDefaultFontResolutionService,
  resolveFont,
  resolveFontText,
} from './orchestration/defaultFontResolutionService.js';
export {
  DEFAULT_PENALTY_WEIGHTS,
  scoreSubstitution,
} from './functions/substitutionPenalty.js';
export {
  classifyDominantScript,
} from './functions/scriptClassifier.js';
export {
  collectRequiredGlyphCodePoints,
  compressGlyphCodePointRanges,
  hasRequiredGlyphCoverage,
} from './functions/glyphCoverage.js';
export type {
  PenaltyWeights,
} from './functions/substitutionPenalty.js';
export type {
  FontCatalogState,
  FontFamilyCandidate,
  FontFamilyCheckResult,
  FontFamilyListRequest,
  FontFamilyListResult,
  FontFamilyStyle,
} from './definitions/fontCatalogQuery.js';
export {
  FontCatalogUnavailableError,
} from './definitions/fontCatalogQuery.js';
export type {
  FontMetadata,
  FontRequest,
  FontResolutionKind,
  ResolvedFont,
  ResolvedCatalogFont,
  ScriptClass,
  UnresolvedFont,
} from './definitions/types.js';
