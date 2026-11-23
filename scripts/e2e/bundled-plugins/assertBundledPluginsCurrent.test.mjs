import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertBundledPluginsCurrent } from './assertBundledPluginsCurrent.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function layout() {
  const root = mkdtempSync(join(tmpdir(), 'bundled-current-'));
  roots.push(root);
  const bundledPluginRoot = join(root, 'bundled');
  const userPluginRoot = join(root, 'user');
  const bundle = (id, version, sums, { onDemand = false } = {}) => {
    mkdirSync(join(bundledPluginRoot, id), { recursive: true });
    writeFileSync(join(bundledPluginRoot, id, 'plugin.json'), JSON.stringify({ id, version }));
    writeFileSync(join(bundledPluginRoot, id, 'SHA512SUMS'), `${sums}\n`);
    if (onDemand) writeFileSync(join(bundledPluginRoot, id, '.install-on-demand'), '');
  };
  const install = (id, version, sums) => {
    mkdirSync(join(userPluginRoot, id, version), { recursive: true });
    writeFileSync(join(userPluginRoot, id, version, 'SHA512SUMS'), `${sums}  \n`);
    writeFileSync(join(userPluginRoot, id, 'active.json'), JSON.stringify({ version }));
  };
  return { bundledPluginRoot, userPluginRoot, bundle, install };
}
const listed = (id, version, state = 'enabled') => ({ meta: { id, version }, state });

describe('assertBundledPluginsCurrent', () => {
  it('passes when every bundled plugin is active at the shipped version and content', () => {
    const { bundle, install, ...roots } = layout();
    bundle('slides', '1.1.3', 'new slides');
    bundle('canvas', '0.1.0', 'canvas');
    bundle('knowledge', '0.1.1', 'knowledge', { onDemand: true });
    install('slides', '1.1.3', 'new slides');
    install('canvas', '0.1.0', 'canvas');
    const rows = assertBundledPluginsCurrent({ ...roots, listing: [listed('slides', '1.1.3'), listed('canvas', '0.1.0')] });
    expect(rows.map(row => [row.id, row.activeVersion, row.contentMatches])).toEqual([
      ['canvas', '0.1.0', true], ['knowledge', null, null], ['slides', '1.1.3', true],
    ]);
  });

  it('fails when an upgraded user keeps the old content under the same version', () => {
    // 0.1.0～0.2.1：Slides 一直叫 1.1.2、内容每次不同；插件照样“已启用”，只是跑的是旧内容。
    const { bundle, install, ...roots } = layout();
    bundle('slides', '1.1.2', 'content shipped in 0.2.1');
    install('slides', '1.1.2', 'content first installed by 0.1.0');
    expect(() => assertBundledPluginsCurrent({ ...roots, listing: [listed('slides', '1.1.2')] }))
      .toThrow(/slides@1\.1\.2: 版本目录内容与安装包不同/u);
  });

  it('fails when the shipped version was not activated or a new bundled plugin was not installed', () => {
    const { bundle, install, ...roots } = layout();
    bundle('slides', '1.1.3', 'new');
    bundle('canvas', '0.1.0', 'canvas');
    install('slides', '1.1.2', 'old');
    const run = () => assertBundledPluginsCurrent({ ...roots, listing: [listed('slides', '1.1.2')] });
    expect(run).toThrow(/slides: 启用的是 1\.1\.2，安装包里是 1\.1\.3/u);
    expect(run).toThrow(/canvas: 启用的是 （无）/u);
    expect(run).toThrow(/canvas: 插件列表状态是 （不在列表里）/u);
  });

  it('skips plugins the user removed before upgrading', () => {
    const { bundle, ...roots } = layout();
    bundle('canvas', '0.1.0', 'canvas');
    expect(assertBundledPluginsCurrent({ ...roots, listing: [] }, { skip: ['canvas'] })).toHaveLength(1);
  });
});
