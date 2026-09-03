import path from 'node:path';

import {
  DEVELOPMENT_DATA_DIRECTORY_NAME,
  DEVELOPMENT_DATA_STATE_FILE_NAME,
  RETIRED_DEVELOPMENT_DATA_DIRECTORY_NAME,
  type DevelopmentDataPaths,
} from '../definitions/developmentDataState';

export function resolveDevelopmentDataPaths(developmentRoot: string): DevelopmentDataPaths {
  const resolvedDevelopmentRoot = path.resolve(developmentRoot);
  const dataRoot = path.join(resolvedDevelopmentRoot, DEVELOPMENT_DATA_DIRECTORY_NAME);
  return {
    developmentRoot: resolvedDevelopmentRoot,
    dataRoot,
    stateFile: path.join(dataRoot, DEVELOPMENT_DATA_STATE_FILE_NAME),
    retiredRoot: path.join(resolvedDevelopmentRoot, RETIRED_DEVELOPMENT_DATA_DIRECTORY_NAME),
  };
}
