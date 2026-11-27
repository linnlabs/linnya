import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPluginVitestConfig,
  DEFAULT_PLUGIN_VITEST_MAX_WORKERS,
  resolvePluginVitestMaxWorkers,
} from '../vitest.plugin.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('vitest.plugin.config', () => {
  it('caps default plugin Vitest workers at 12 and scales down on smaller machines', () => {
    expect(DEFAULT_PLUGIN_VITEST_MAX_WORKERS).toBe(12);
    expect(resolvePluginVitestMaxWorkers(undefined, 18)).toBe(12);
    expect(resolvePluginVitestMaxWorkers('', 4)).toBe(4);
    expect(resolvePluginVitestMaxWorkers('  ', 1)).toBe(1);
    expect(resolvePluginVitestMaxWorkers('6', 18)).toBe(6);
    expect(resolvePluginVitestMaxWorkers('16', 18)).toBe(16);
  });

  it('rejects non-positive or non-integer LINNYA_PLUGIN_VITEST_MAX_WORKERS values', () => {
    expect(() => resolvePluginVitestMaxWorkers('0', 18)).toThrow('positive integer');
    expect(() => resolvePluginVitestMaxWorkers('-2', 18)).toThrow('positive integer');
    expect(() => resolvePluginVitestMaxWorkers('1.5', 18)).toThrow('positive integer');
    expect(() => resolvePluginVitestMaxWorkers('auto', 18)).toThrow('positive integer');
  });

  it('applies maxWorkers and prepends package aliases before host aliases', () => {
    vi.stubEnv('LINNYA_PLUGIN_VITEST_MAX_WORKERS', '7');
    const config = createPluginVitestConfig({
      packageDirectory: '/tmp/example-plugin',
      packageAliases: [{ find: '@plugin/example', replacement: '/tmp/example-plugin/src' }],
    });

    expect(config.root).toBe('/tmp/example-plugin');
    expect(config.test?.maxWorkers).toBe(7);
    expect(Array.isArray(config.resolve?.alias)).toBe(true);
    const aliases = config.resolve?.alias as Array<{ find: unknown }>;
    expect(aliases[0]?.find).toBe('@plugin/example');
  });
});
