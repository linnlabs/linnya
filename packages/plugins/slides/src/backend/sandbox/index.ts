export {
  pptComposeProfile,
  readPptComposeRawPayload,
} from './pptComposeProfile';
export type {
  PptComposeCreateValue,
  PptComposeSandboxValue,
} from './pptComposeProfile';
export {
  instrumentDeckSourceForLayoutTrace,
  LAYOUT_TRACE_RUNTIME_SOURCE,
  readLayoutTrace,
} from './layoutTrace';
export type {
  LayoutTraceNode,
  LayoutTraceNodeType,
  LayoutTraceSnapshot,
} from './layoutTrace';
export {
  buildChartOptionsFromParams,
  CHART_PRESET_NAMES,
  CHART_PRESETS,
  resolveChartPreset,
} from './chartPresets';
export type {
  ChartPreset,
  ChartPresetName,
} from './chartPresets';
export {
  LAYOUT_PRIMITIVES_SOURCE,
} from './layoutPrimitives';
export {
  __clearAmbientCacheForTests,
  __clearLibFileCacheForTests,
  createVirtualCompilerHost,
  formatDiagnosticsForAi,
  loadAmbient,
  TYPECHECK_USER_FILE_VIRTUAL_NAME,
  typecheckCodegenSource,
} from './codegenTypecheck';
export type {
  AmbientHandle,
  AmbientLoaderOptions,
  FormatDiagnosticsOptions,
  FormattedDiagnostic,
  FormattedDiagnosticsBundle,
  TypecheckOptions,
  TypecheckResult,
  VirtualCompilerHostOptions,
} from './codegenTypecheck';
