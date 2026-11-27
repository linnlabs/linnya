import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GUARD_CONCURRENCY,
  resolveGuardConcurrency,
  runParallelPnpmScripts,
  validateScriptNames,
} from './parallelPnpmScripts.mjs';

describe('parallelPnpmScripts', () => {
  it('validates non-empty, unique, well-formed pnpm script names', () => {
    expect(validateScriptNames(['guard:a', 'lint:style', 'release:lock:production:audit'])).toEqual([
      'guard:a',
      'lint:style',
      'release:lock:production:audit',
    ]);
    expect(() => validateScriptNames([])).toThrow('At least one');
    expect(() => validateScriptNames(['guard:a', 'guard:a'])).toThrow('Duplicate');
    expect(() => validateScriptNames(['guard:a; rm -rf'])).toThrow('Invalid pnpm script name');
  });

  it('caps default concurrency at 2, scales with cores and script count, and supports overrides', () => {
    expect(DEFAULT_GUARD_CONCURRENCY).toBe(2);
    expect(resolveGuardConcurrency(undefined, 23, 18)).toBe(2);
    expect(resolveGuardConcurrency('', 3, 18)).toBe(2);
    expect(resolveGuardConcurrency(undefined, 10, 1)).toBe(1);
    expect(resolveGuardConcurrency(undefined, 1, 18)).toBe(1);
    expect(resolveGuardConcurrency('6', 23, 18)).toBe(6);
    expect(resolveGuardConcurrency('10', 3, 18)).toBe(3);
    expect(() => resolveGuardConcurrency('0', 5, 18)).toThrow('positive integer');
    expect(() => resolveGuardConcurrency('-1', 5, 18)).toThrow('positive integer');
    expect(() => resolveGuardConcurrency('1.5', 5, 18)).toThrow('positive integer');
    expect(() => resolveGuardConcurrency('auto', 5, 18)).toThrow('positive integer');
  });

  it('bounds active workers, runs all scripts despite earlier failure, and preserves failure exit code', async () => {
    let active = 0;
    let peak = 0;
    const executed = [];

    const summary = await runParallelPnpmScripts({
      scripts: ['guard:one', 'guard:fail-first', 'guard:three', 'guard:fail-second', 'guard:five'],
      concurrency: 2,
      cwd: '/tmp/repo',
      runScript: async ({ name }) => {
        active += 1;
        peak = Math.max(peak, active);
        executed.push(name);
        await new Promise(resolve => setTimeout(resolve, name === 'guard:fail-first' ? 5 : 15));
        active -= 1;
        if (name === 'guard:fail-first') return { exitCode: 2, durationMs: 5, output: 'err1' };
        if (name === 'guard:fail-second') return { exitCode: 3, durationMs: 15, output: 'err2' };
        return { exitCode: 0, durationMs: 15, output: '' };
      },
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(executed).toHaveLength(5);
    expect(summary.ok).toBe(false);
    expect(summary.firstFailureExitCode).toBe(2);
    expect(summary.results.map(item => item.name)).toEqual([
      'guard:one',
      'guard:fail-first',
      'guard:three',
      'guard:fail-second',
      'guard:five',
    ]);
  });
});
