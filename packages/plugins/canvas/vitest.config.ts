import path from 'node:path';
import { createPluginVitestConfig } from '../../../scripts/test-runner/vitest.plugin.config';
export default createPluginVitestConfig({ packageDirectory: import.meta.dirname, packageAliases: [{ find: /^@plugin\/canvas\/shared$/, replacement: path.resolve(import.meta.dirname, 'src/shared/index.ts') }] });
