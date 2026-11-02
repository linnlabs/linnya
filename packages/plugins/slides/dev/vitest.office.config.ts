import { defineConfig } from 'vitest/config';
import slidesConfig from '../vitest.config';
export default defineConfig({
  ...slidesConfig,
  test: { ...slidesConfig.test, include: ['dev/powerpoint/**/*.test.ts'] },
});
