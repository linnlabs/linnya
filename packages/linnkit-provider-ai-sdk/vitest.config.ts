import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const linnkitRoot = path.dirname(require.resolve('@linnlabs/linnkit/package.json'));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@linnlabs\/linnkit-provider-ai-sdk\/conformance$/,
        replacement: path.resolve(packageRoot, 'conformance/index.ts'),
      },
      {
        find: /^@linnlabs\/linnkit-provider-ai-sdk$/,
        replacement: path.resolve(packageRoot, 'src/index.ts'),
      },
      {
        find: /^@linnlabs\/linnkit\/ports$/,
        replacement: path.resolve(linnkitRoot, 'src/ports/index.ts'),
      },
      {
        find: /^@linnlabs\/linnkit\/contracts$/,
        replacement: path.resolve(linnkitRoot, 'src/contracts/index.ts'),
      },
      {
        find: /^@linnlabs\/linnkit$/,
        replacement: path.resolve(linnkitRoot, 'src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
  },
});
