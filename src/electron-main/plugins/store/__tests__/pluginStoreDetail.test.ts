import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginStateView } from '@app/schemas';
import { buildPluginStoreDetail } from '../pluginStoreDetail';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-store-detail-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makePluginState(options: {
  pluginId: string;
  state: PluginStateView['state'];
  required?: boolean;
}): PluginStateView {
  return {
    meta: {
      id: options.pluginId,
      name: options.pluginId,
      version: '1.0.0',
      description: `${options.pluginId} plugin`,
      developer: 'Linnya',
      builtin: options.pluginId !== 'demo',
      required: options.required,
    },
    state: options.state,
  };
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('buildPluginStoreDetail', () => {
  it('从 active 插件目录读取用户详情、版本更新、skills 与 agents', () => {
    const tempRoot = makeTempRoot();
    const pluginRoot = path.join(tempRoot, 'plugins');
    const versionDir = path.join(pluginRoot, 'demo/1.0.0');
    writeJson(path.join(pluginRoot, 'demo/active.json'), { version: '1.0.0' });
    writeJson(path.join(versionDir, 'plugin.json'), {
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      developer: 'Linnya',
      homepage: 'https://linnyai.com',
      details: ['Demo detailed introduction.'],
      releaseNotes: [
        { version: '1.0.0', title: 'Initial release', description: 'First structured detail.' },
      ],
      skills: [{ name: 'Demo Skill', description: 'Demo skill description' }],
      agents: [{ name: 'Demo Agent', description: 'Demo agent description' }],
      compat: { rendererUi: '*' },
      entry: {
        renderer: './dist/renderer/index.js',
      },
    });
    const state = makePluginState({ pluginId: 'demo', state: 'enabled' });
    const detail = buildPluginStoreDetail(state, {
      pluginRoot,
    });

    expect(detail.sizeBytes).toBeGreaterThan(0);
    expect(detail.homepage).toBe('https://linnyai.com');
    expect(detail.details).toEqual(['Demo detailed introduction.']);
    expect(detail.releaseNotes).toEqual([
      { version: '1.0.0', title: 'Initial release', description: 'First structured detail.' },
    ]);
    expect(detail.skills).toEqual([{ name: 'Demo Skill', description: 'Demo skill description' }]);
    expect(detail.agents).toEqual([{ name: 'Demo Agent', description: 'Demo agent description' }]);
  });

  it('插件卸载后从 bundled 插件目录读取市场详情和大小', () => {
    const tempRoot = makeTempRoot();
    const bundledPluginRoot = path.join(tempRoot, 'bundled');
    const bundledPluginDir = path.join(bundledPluginRoot, 'bundled-demo');
    writeJson(path.join(bundledPluginDir, 'plugin.json'), {
      id: 'bundled-demo',
      version: '1.0.4',
      name: 'Bundled Demo',
      description: 'Bundled demo plugin',
      developer: 'Linnya',
      details: ['Detailed introduction from bundled artifact.'],
      releaseNotes: [
        { version: '1.0.4', title: 'Store detail', description: 'Show detail after uninstall.' },
      ],
      agents: [{ name: 'Reasoning Canvas', description: 'Reason on the current document.' }],
      compat: { rendererUi: '*' },
      entry: {
        backend: './dist/backend/index.cjs',
        renderer: './dist/renderer/index.js',
      },
    });
    fs.writeFileSync(path.join(bundledPluginDir, 'dist.txt'), 'bundled plugin payload', 'utf8');

    const state = makePluginState({ pluginId: 'bundled-demo', state: 'missing' });
    const detail = buildPluginStoreDetail(state, {
      bundledPluginRoot,
    });

    expect(detail.meta.id).toBe('bundled-demo');
    expect(detail.sizeBytes).toBeGreaterThan(0);
    expect(detail.details).toEqual(['Detailed introduction from bundled artifact.']);
    expect(detail.releaseNotes).toEqual([
      { version: '1.0.4', title: 'Store detail', description: 'Show detail after uninstall.' },
    ]);
    expect(detail.skills).toBeUndefined();
    expect(detail.agents).toEqual([
      { name: 'Reasoning Canvas', description: 'Reason on the current document.' },
    ]);
  });

  it('插件启用但没有 active artifact 时回退到 bundled 市场详情', () => {
    const tempRoot = makeTempRoot();
    const bundledPluginRoot = path.join(tempRoot, 'bundled');
    const bundledPluginDir = path.join(bundledPluginRoot, 'enabled-demo');
    writeJson(path.join(bundledPluginDir, 'plugin.json'), {
      id: 'enabled-demo',
      version: '0.1.0',
      name: 'Enabled Demo',
      description: 'Enabled demo plugin',
      developer: 'Linnya',
      details: ['Enabled bundled detail.'],
      releaseNotes: [
        { version: '0.1.0', title: 'Sheet pluginized', description: 'Bundled detail is visible.' },
      ],
      skills: [{ name: 'demo-analyst', description: 'Analyze demo data.' }],
      agents: [{ name: 'Demo Editor', description: 'Edit demo content.' }],
      compat: { rendererUi: '*' },
      entry: {
        backend: './dist/backend/index.cjs',
        renderer: './dist/renderer/index.js',
      },
    });
    fs.writeFileSync(path.join(bundledPluginDir, 'dist.txt'), 'bundled sheet payload', 'utf8');

    const state = makePluginState({ pluginId: 'enabled-demo', state: 'enabled' });
    const detail = buildPluginStoreDetail(state, {
      pluginRoot: path.join(tempRoot, 'plugins'),
      bundledPluginRoot,
    });

    expect(detail.sizeBytes).toBeGreaterThan(0);
    expect(detail.details).toEqual(['Enabled bundled detail.']);
    expect(detail.skills).toEqual([{ name: 'demo-analyst', description: 'Analyze demo data.' }]);
    expect(detail.agents).toEqual([{ name: 'Demo Editor', description: 'Edit demo content.' }]);
  });

  it('插件没有 active artifact 且没有 bundled artifact 时只返回结构化核心信息', () => {
    const state = makePluginState({ pluginId: 'demo', state: 'enabled' });
    const detail = buildPluginStoreDetail(state, {});

    expect(detail.meta.id).toBe('demo');
    expect(detail.details).toBeUndefined();
    expect(detail.releaseNotes).toBeUndefined();
    expect(detail.skills).toBeUndefined();
    expect(detail.agents).toBeUndefined();
  });
});
