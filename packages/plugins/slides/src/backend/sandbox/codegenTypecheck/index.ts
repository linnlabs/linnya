export {
  typecheckCodegenSource,
  type TypecheckOptions,
  type TypecheckResult,
  TYPECHECK_USER_FILE_VIRTUAL_NAME,
} from './typecheckCodegenSource.js';
export {
  formatDiagnosticsForAi,
  type FormatDiagnosticsOptions,
  type FormattedDiagnostic,
  type FormattedDiagnosticsBundle,
} from './diagnosticFormatter.js';
export {
  loadAmbient,
  __clearAmbientCacheForTests,
  type AmbientHandle,
  type AmbientLoaderOptions,
} from './ambientLoader.js';
export { createVirtualCompilerHost, type VirtualCompilerHostOptions } from './compilerHost.js';
export { __clearLibFileCacheForTests } from './libFileCache.js';
