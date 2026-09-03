import path from 'node:path';

import { createPluginVitestConfig } from '../../../scripts/test-runner/vitest.plugin.config';

const packageDirectory = import.meta.dirname;

export default createPluginVitestConfig({
  packageDirectory,
  packageAliases: [
    {
      find: /^@plugin\/mindmap\/shared$/,
      replacement: path.resolve(packageDirectory, 'src/shared/index.ts'),
    },
    {
      find: /^@plugin\/mindmap\/backend$/,
      replacement: path.resolve(packageDirectory, 'src/backend/index.ts'),
    },
    {
      find: /^@plugin\/mindmap\/backend-test-support$/,
      replacement: path.resolve(packageDirectory, 'src/backend/test-support.ts'),
    },
    {
      find: /^@plugin\/mindmap\/renderer$/,
      replacement: path.resolve(packageDirectory, 'src/renderer/index.ts'),
    },
  ],
});
