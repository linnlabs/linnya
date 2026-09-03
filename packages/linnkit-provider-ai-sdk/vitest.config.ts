import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

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
    ],
  },
  test: {
    environment: 'node',
  },
});
