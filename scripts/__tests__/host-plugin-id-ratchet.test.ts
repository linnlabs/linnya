import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compareWithBaseline,
  findPluginIdReferences,
  readWorkspacePluginIds,
  runHostPluginIdRatchet,
  scanHostPluginIdReferences,
} from '../guards/host-plugin-id-ratchet';

const IDS = ['canvas', 'decision', 'knowledge', 'slides'];

function found(source: string): string[] {
  return findPluginIdReferences(source, 'fixture.ts', IDS).map(reference => reference.pluginId);
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeFile(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

describe('host plugin id ratchet', () => {
  it('当前 Host 插件 ID 引用与 baseline 精确一致', () => {
    const { added, removed } = runHostPluginIdRatchet();
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  it('识别插件身份位置：比较、plugin 调用参数、plugin 属性与 switch 分支', () => {
    expect(found("if (entry.pluginId !== 'knowledge') return;")).toEqual(['knowledge']);
    expect(found("getRegisteredBackendPluginUploadChannel('slides');")).toEqual(['slides']);
    expect(found("const port = { pluginId: 'canvas', route: 'x' };")).toEqual(['canvas']);
    expect(found("switch (plugin.id) { case 'decision': break; }")).toEqual(['decision']);
  });

  it('识别插件路径、路由与 plugin:// 资源地址', () => {
    expect(found("const dir = path.resolve(root, 'packages/plugins/knowledge');")).toEqual(['knowledge']);
    expect(found("fetch('/api/v1/plugins/slides/documents/upload');")).toEqual(['slides']);
    expect(found("import('plugin://canvas/dist/renderer/index.js');")).toEqual(['canvas']);
    expect(found("const other = 'packages/plugins/knowledge-extra';")).toEqual([]);
  });

  it('普通单词、类型字面量与 DOM 元素名不算插件 ID', () => {
    expect(found("type Kind = 'decision' | 'result';")).toEqual([]);
    expect(found("if (row.kind === 'decision') next();")).toEqual([]);
    expect(found("document.createElement('canvas');")).toEqual([]);
    expect(found("path.join(extractDir, 'ppt', 'slides');")).toEqual([]);
  });

  it('只扫描 Host 生产源码，跳过测试、开发夹具和插件包；新增引用按文件计入 diff', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-plugin-id-'));
    temporaryRoots.push(root);
    writeFile(root, 'packages/plugins/notes/plugin.json', JSON.stringify({ id: 'notes' }));
    writeFile(root, 'src/host/trust.ts', "export const ok = (pluginId: string) => pluginId === 'notes';");
    writeFile(root, 'src/host/__tests__/trust.test.ts', "expect(pluginId === 'notes').toBe(true);");
    writeFile(root, 'apps/renderer/app/page.vue', "<template><p>notes</p></template>\n<script setup lang=\"ts\">\nconst surface = usePluginSurface('notes');\n</script>");
    writeFile(root, 'packages/plugins/notes/src/index.ts', "registerPlugin('notes');");

    expect(readWorkspacePluginIds(root)).toEqual(['notes']);
    const references = scanHostPluginIdReferences(root);
    expect(references.map(reference => reference.file).sort()).toEqual(['apps/renderer/app/page.vue', 'src/host/trust.ts']);
    expect(compareWithBaseline(references, ['notes src/host/trust.ts', 'notes src/removed.ts'])).toMatchObject({
      added: ['notes apps/renderer/app/page.vue'],
      removed: ['notes src/removed.ts'],
    });
  });
});
