import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { collectToolDirectoryBoundaryViolations } from '../guards/tool-directory-boundary-guard';

const temporaryRoots: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'linnya-tool-boundary-'));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, 'src/tools'), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('tool directory boundary guard', () => {
  it('允许三个顶层公共入口', () => {
    const root = createRepository();
    for (const filename of ['index.ts', 'ports.ts', 'types.ts']) {
      writeFileSync(path.join(root, 'src/tools', filename), 'export {};\n');
    }

    expect(collectToolDirectoryBoundaryViolations(root)).toEqual([]);
  });

  it('拒绝退役目录和根级脚本', () => {
    const root = createRepository();
    mkdirSync(path.join(root, 'src/tools/test'));
    writeFileSync(path.join(root, 'src/tools/reset-data.ts'), 'export {};\n');

    expect(collectToolDirectoryBoundaryViolations(root).map(item => item.path)).toEqual([
      'src/tools/test',
      'src/tools/reset-data.ts',
    ]);
  });
});
