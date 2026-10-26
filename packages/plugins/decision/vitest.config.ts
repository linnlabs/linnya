import { createPluginVitestConfig } from '../../../scripts/test-runner/vitest.plugin.config';

export default createPluginVitestConfig({
  packageDirectory: import.meta.dirname,
  packageAliases: [],
});
