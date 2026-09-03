import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const slidesPackageDirectory = path.resolve(import.meta.dirname, '../../..');
const schemasPackageDirectory = path.resolve(slidesPackageDirectory, '../../schemas');

function readSchemasPackageJson(): { exports?: Record<string, unknown> } {
  return JSON.parse(
    readFileSync(path.join(schemasPackageDirectory, 'package.json'), 'utf8'),
  ) as { exports?: Record<string, unknown> };
}

describe('@app/schemas Slides boundary', () => {
  it('does not expose the Slides render contract from package exports', () => {
    const packageJson = readSchemasPackageJson();

    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports).not.toHaveProperty('./ai-ppt');
  });

  it('does not re-export Slides contracts from the root schema entry', () => {
    const rootIndex = readFileSync(path.join(schemasPackageDirectory, 'src/index.ts'), 'utf8');

    expect(rootIndex).not.toContain('./ai-ppt');
  });

  it('keeps Slides-owned schemas out of the host schemas source tree', () => {
    expect(existsSync(path.join(schemasPackageDirectory, 'src/ai-ppt'))).toBe(false);
  });
});
