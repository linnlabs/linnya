import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runRewriteLinnkitSelfImportsCodemod } from '../rewrite-linnkit-self-imports';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rewrite-linnkit-self-imports-'));
}

async function writeFile(rootDir: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

async function readFile(rootDir: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8');
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe('runRewriteLinnkitSelfImportsCodemod', () => {
  it('rewrites package self-imports to relative specifiers', async () => {
    const rootDir = await makeTempDir();
    tempDirs.push(rootDir);

    await writeFile(rootDir, 'packages/linnkit/src/shared/ids.ts', 'export const ids = true;\n');
    await writeFile(rootDir, 'packages/linnkit/src/contracts/index.ts', 'export type RuntimeEvent = { id: string };\n');
    await writeFile(
      rootDir,
      'packages/linnkit/src/runtime-kernel/events/eventMappers.ts',
      [
        "import { ids } from 'src/agent/shared/ids';",
        "import type { RuntimeEvent } from 'src/agent/contracts';",
        '',
        'export function mapEvent(event: RuntimeEvent) {',
        '  return { ids, event };',
        '}',
        '',
      ].join('\n'),
    );

    const report = await runRewriteLinnkitSelfImportsCodemod({
      rootDir,
      include: ['packages/linnkit/src/**/*.ts'],
    });

    const updated = await readFile(rootDir, 'packages/linnkit/src/runtime-kernel/events/eventMappers.ts');
    expect(updated).toContain("import { ids } from '../../shared/ids';");
    expect(updated).toContain("import type { RuntimeEvent } from '../../contracts';");
    expect(report.filesChanged).toBe(1);
    expect(report.rewrittenImports).toBe(2);
  });

  it('rewrites root barrel and dynamic import usages', async () => {
    const rootDir = await makeTempDir();
    tempDirs.push(rootDir);

    await writeFile(rootDir, 'packages/linnkit/src/index.ts', 'export const runtimeKernel = true;\n');
    await writeFile(rootDir, 'packages/linnkit/src/runtime-kernel/graph-engine/nodes/llmNode.ts', 'export const llmNode = true;\n');
    await writeFile(
      rootDir,
      'packages/linnkit/src/runtime-kernel/__tests__/surface.test.ts',
      [
        "import { runtimeKernel } from 'src/agent';",
        "type LlmNodeModule = typeof import('src/agent/runtime-kernel/graph-engine/nodes/llmNode');",
        '',
        'export async function load(): Promise<LlmNodeModule> {',
        "  await import('src/agent');",
        "  return import('src/agent/runtime-kernel/graph-engine/nodes/llmNode');",
        '}',
        '',
        'export const value = runtimeKernel;',
        '',
      ].join('\n'),
    );

    const report = await runRewriteLinnkitSelfImportsCodemod({
      rootDir,
      include: ['packages/linnkit/src/**/*.ts'],
    });

    const updated = await readFile(rootDir, 'packages/linnkit/src/runtime-kernel/__tests__/surface.test.ts');
    expect(updated).toContain("import { runtimeKernel } from '../..';");
    expect(updated).toContain("type LlmNodeModule = typeof import('../graph-engine/nodes/llmNode');");
    expect(updated).toContain("await import('../..');");
    expect(updated).toContain("return import('../graph-engine/nodes/llmNode');");
    expect(report.rewrittenImports).toBe(4);
  });

  it('rewrites export declarations inside the moved package', async () => {
    const rootDir = await makeTempDir();
    tempDirs.push(rootDir);

    await writeFile(rootDir, 'packages/linnkit/src/context-manager/shared/providers/index.ts', 'export const provider = true;\n');
    await writeFile(
      rootDir,
      'packages/linnkit/src/context-manager/profiles/agent/context/providers/index.ts',
      [
        "export { provider } from 'src/agent/context-manager/shared/providers';",
        '',
      ].join('\n'),
    );

    const report = await runRewriteLinnkitSelfImportsCodemod({
      rootDir,
      include: ['packages/linnkit/src/**/*.ts'],
    });

    const updated = await readFile(rootDir, 'packages/linnkit/src/context-manager/profiles/agent/context/providers/index.ts');
    expect(updated).toContain("export { provider } from '../../../../shared/providers';");
    expect(report.rewrittenImports).toBe(1);
  });

  it('throws when a self-import target cannot be resolved', async () => {
    const rootDir = await makeTempDir();
    tempDirs.push(rootDir);

    await writeFile(
      rootDir,
      'packages/linnkit/src/runtime-kernel/events/broken.ts',
      [
        "import { missing } from 'src/agent/shared/missing';",
        '',
        'export { missing };',
        '',
      ].join('\n'),
    );

    await expect(
      runRewriteLinnkitSelfImportsCodemod({
        rootDir,
        include: ['packages/linnkit/src/**/*.ts'],
      }),
    ).rejects.toThrow(
      'rewrite-linnkit-self-imports found unresolved src/agent self-imports inside packages/linnkit/src.',
    );
  });

  it('reports dry-run changes without writing files', async () => {
    const rootDir = await makeTempDir();
    tempDirs.push(rootDir);

    const original = [
      "import type { RuntimeEvent } from 'src/agent/contracts';",
      '',
      'export function size(events: RuntimeEvent[]): number {',
      '  return events.length;',
      '}',
      '',
    ].join('\n');

    await writeFile(rootDir, 'packages/linnkit/src/contracts/index.ts', 'export type RuntimeEvent = { id: string };\n');
    await writeFile(rootDir, 'packages/linnkit/src/runtime-kernel/dryRun.ts', original);

    const report = await runRewriteLinnkitSelfImportsCodemod({
      rootDir,
      include: ['packages/linnkit/src/**/*.ts'],
      dryRun: true,
    });

    const afterDryRun = await readFile(rootDir, 'packages/linnkit/src/runtime-kernel/dryRun.ts');

    expect(afterDryRun).toBe(original);
    expect(report.filesChanged).toBe(1);
    expect(report.rewrittenImports).toBe(1);
    expect(report.updatedFiles).toEqual(['packages/linnkit/src/runtime-kernel/dryRun.ts']);
  });
});
