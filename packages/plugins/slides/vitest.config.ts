import path from 'node:path';

import { createPluginVitestConfig } from '../../../scripts/test-runner/vitest.plugin.config';

const packageDirectory = import.meta.dirname;

export default createPluginVitestConfig({
  packageDirectory,
  packageAliases: [
    {
      find: /^@plugin\/slides\/shared$/,
      replacement: path.resolve(packageDirectory, 'src/shared/index.ts'),
    },
    {
      find: /^@plugin\/slides\/shared\/(.+)$/,
      replacement: path.resolve(packageDirectory, 'src/shared/$1'),
    },
    {
      find: /^@plugin\/slides\/backend$/,
      replacement: path.resolve(packageDirectory, 'src/backend/index.ts'),
    },
    {
      find: /^@plugin\/slides\/renderer$/,
      replacement: path.resolve(packageDirectory, 'src/renderer/index.ts'),
    },
  ],
});
