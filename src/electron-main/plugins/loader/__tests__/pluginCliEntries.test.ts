import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listPluginCliEntries } from '../pluginCliEntries';

const temporaryRoots: string[] = [];

function createPlugin(input: {
  readonly id: string;
  readonly version?: string;
  readonly command?: string;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-cli-'));
  temporaryRoots.push(root);
  const pluginDir = path.join(root, input.id, input.version ?? '1.0.0');
  fs.mkdirSync(path.join(pluginDir, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id: input.id,
    version: input.version ?? '1.0.0',
    name: input.id,
    description: input.id,
    developer: 'test',
    entry: {
      backend: './dist/backend.cjs',
      ...(input.command ? { command: input.command } : {}),
    },
  }));
  if (input.command) {
    fs.writeFileSync(path.join(pluginDir, input.command), '');
  }
  return pluginDir;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('listPluginCliEntries', () => {
  it('只发现带 command entry 的插件，并返回 active artifact 内入口', () => {
    const pluginDir = createPlugin({ id: 'fake', command: './dist/cli/fake.cjs' });
    createPlugin({ id: 'without-cli' });

    expect(listPluginCliEntries({ directPluginDirs: [pluginDir] })).toEqual([
      expect.objectContaining({
        pluginId: 'fake',
        version: '1.0.0',
        entryPath: path.join(pluginDir, 'dist', 'cli', 'fake.cjs'),
      }),
    ]);
  });

  it('拒绝插件目录外的 command entry，并把缺失入口视为不可用', () => {
    const pluginDir = createPlugin({ id: 'escape', command: '../outside.cjs' });
    const diagnostics: string[] = [];

    expect(listPluginCliEntries({
      directPluginDirs: [pluginDir],
      reportDiagnostic: ({ message }) => diagnostics.push(message),
    })).toEqual([]);
    expect(diagnostics.some(message => message.includes('读取插件 CLI 入口失败'))).toBe(true);
  });
});
