import { describe, expect, it } from 'vitest';

import {
  findCodenameViolations,
  isCodenameAuthorityFile,
  type CodenameViolation,
} from '../guards/agent-codename-lint';

function symbolsFor(filePath: string, content: string): string[] {
  return findCodenameViolations(filePath, content).map((violation) => violation.symbol);
}

function firstViolation(filePath: string, content: string): CodenameViolation {
  const violations = findCodenameViolations(filePath, content);
  expect(violations.length).toBeGreaterThan(0);
  const violation = violations[0];
  if (violation === undefined) {
    throw new Error(`expected codename violation for ${filePath}`);
  }
  return violation;
}

describe('isCodenameAuthorityFile', () => {
  it('allows local legacy agent authority files', () => {
    expect(isCodenameAuthorityFile('src/agent/index.ts')).toBe(true);
    expect(isCodenameAuthorityFile('src/agent/__tests__/package.manifest.test.ts')).toBe(true);
  });

  it('does not allow unrelated business files', () => {
    expect(isCodenameAuthorityFile('src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts')).toBe(false);
  });
});

describe('findCodenameViolations', () => {
  it('does NOT flag linnkit (now the official package name, no longer a codename)', () => {
    expect(
      symbolsFor(
        'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts',
        'const packageName = "linnkit";',
      ),
    ).toEqual([]);
  });

  it('flags legacy linngent leakage in business code', () => {
    expect(
      symbolsFor(
        'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts',
        'const oldCodeName = "linngent";',
      ),
    ).toEqual(['linngent']);
  });

  it('allows codename usage in authority files (defensive — currently no codename remains beyond linngent)', () => {
    expect(
      symbolsFor(
        'src/agent/__tests__/package.manifest.test.ts',
        "expect(historicalAlias).toBe('linngent');",
      ),
    ).toEqual([]);
  });

  it('ignores files without codenames', () => {
    expect(
      symbolsFor(
        'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts',
        'const packageName = "agent";',
      ),
    ).toEqual([]);
  });

  it('reports the matched line number and preview for linngent', () => {
    const violation = firstViolation(
      'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts',
      [
        'const stableName = "agent";',
        'const oldCodeName = "linngent";',
      ].join('\n'),
    );

    expect(violation.line).toBe(2);
    expect(violation.preview).toContain('linngent');
  });
});
