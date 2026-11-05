export { resolveDevelopmentInstancePaths } from './functions/resolveDevelopmentInstancePaths';
export {
  PRODUCTION_DATA_DIRECTORY_NAME,
  resolveProductionDataRoot,
  type ProductionDataRootInput,
} from './functions/resolveProductionDataRoot';
export type { RuntimePathRoots } from './definitions/runtimePathRoots';
export { createRuntimePathRoots } from './functions/createRuntimePathRoots';
export {
  installRuntimePathRoots,
  readInstalledRuntimePathRoots,
} from './registry/runtimePathRootsRegistry';
