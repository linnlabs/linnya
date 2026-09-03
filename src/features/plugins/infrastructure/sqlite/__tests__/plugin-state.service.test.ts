import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { PluginStateService } from '../plugin-state.service';

const platformMeta: PluginMeta = {
  id: 'platform',
  name: 'Platform',
  version: '1.0.0',
  description: 'Core',
  developer: 'Linnya',
  builtin: true,
  required: true,
};

const mindmapMeta: PluginMeta = {
  id: 'mindmap',
  name: 'Mindmap',
  version: '1.0.0',
  description: 'Mindmap plugin',
  developer: 'Linnya',
  builtin: true,
  compatMin: '0.0.36',
};

const sheetMeta: PluginMeta = {
  id: 'sheet',
  name: 'Sheet',
  version: '1.0.0',
  description: 'Sheet plugin',
  developer: 'Linnya',
  builtin: true,
};

const sheetAutomationMeta: PluginMeta = {
  id: 'sheet-automation',
  name: 'Sheet Automation',
  version: '1.0.0',
  description: 'Sheet automation plugin',
  developer: 'Linnya',
  builtin: true,
  dependsOn: ['sheet'],
};

function createPluginTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id    TEXT PRIMARY KEY,
      version      TEXT NOT NULL,
      name         TEXT NOT NULL DEFAULT '',
      installed    INTEGER NOT NULL DEFAULT 1,
      builtin      INTEGER NOT NULL DEFAULT 0,
      required     INTEGER NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 0,
      compat_min TEXT,
      source TEXT NOT NULL DEFAULT 'builtin',
      user_removed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE enabled_plugins (
      plugin_id  TEXT PRIMARY KEY,
      enabled_at INTEGER NOT NULL,
      FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
    );
  `);
}

describe('PluginStateService', () => {
  let db: Database.Database;
  let service: PluginStateService;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginTables(db);
    service = new PluginStateService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('默认启用首次登记的内置插件', () => {
    service.ensureBuiltinInstalled([platformMeta, mindmapMeta]);

    expect(service.listStates([platformMeta, mindmapMeta])).toEqual([
      { meta: platformMeta, state: 'enabled' },
      { meta: mindmapMeta, state: 'enabled' },
    ]);
  });

  it('记录内置插件版本化字段，供插件迁移执行器读取', () => {
    service.ensureBuiltinInstalled([mindmapMeta]);

    expect(service.getInstalledRecord('mindmap')).toEqual({
      pluginId: 'mindmap',
      version: '1.0.0',
      schemaVersion: 0,
      compatMin: '0.0.36',
      source: 'builtin',
      installed: true,
      builtin: true,
      required: false,
      userRemoved: false,
    });
  });

  it('可只登记 known 插件 catalog 行，不把它误装成已安装', () => {
    service.ensureKnownPluginRegistered(mindmapMeta);

    expect(service.getInstalledRecord('mindmap')).toMatchObject({
      pluginId: 'mindmap',
      version: '1.0.0',
      installed: false,
      builtin: true,
      required: false,
      userRemoved: false,
    });
    expect(service.listStates([mindmapMeta])).toEqual([
      { meta: mindmapMeta, state: 'missing', reason: '插件未安装' },
    ]);
    expect(service.getEnabledIds()).toEqual([]);
  });

  it('重启式登记会同步仍安装的 builtin meta 版本、compat_min 和 source', () => {
    service.ensureBuiltinInstalled([mindmapMeta]);
    const updatedMindmapMeta: PluginMeta = {
      ...mindmapMeta,
      version: '1.0.1',
      compatMin: '0.0.37',
    };

    service.ensureBuiltinInstalled([updatedMindmapMeta]);

    expect(service.getInstalledRecord('mindmap')).toMatchObject({
      version: '1.0.1',
      compatMin: '0.0.37',
      source: 'builtin',
    });
  });

  it('不会在重启式登记时重新启用用户禁用过的非 required 插件', () => {
    service.ensureBuiltinInstalled([platformMeta, mindmapMeta]);
    service.setEnabled('mindmap', false);

    service.ensureBuiltinInstalled([platformMeta, mindmapMeta]);

    expect(service.listStates([platformMeta, mindmapMeta])).toEqual([
      { meta: platformMeta, state: 'enabled' },
      { meta: mindmapMeta, state: 'disabled' },
    ]);
  });

  it('卸载非 required 插件后保留 known meta，并显示 missing', () => {
    service.ensureBuiltinInstalled([platformMeta, mindmapMeta]);

    service.setInstalled('mindmap', false);

    expect(service.listStates([platformMeta, mindmapMeta])).toEqual([
      { meta: platformMeta, state: 'enabled' },
      { meta: mindmapMeta, state: 'missing', reason: '插件未安装' },
    ]);
    expect(service.getEnabledIds()).toEqual(['platform']);
  });

  it('用户主动移除的内置插件不会被重启式登记重新安装', () => {
    service.ensureBuiltinInstalled([platformMeta, mindmapMeta]);
    service.setInstalled('mindmap', false, [platformMeta, mindmapMeta]);
    service.setUserRemoved('mindmap', true);

    service.ensureBuiltinInstalled([platformMeta, mindmapMeta]);

    expect(service.getInstalledRecord('mindmap')).toMatchObject({
      installed: false,
      userRemoved: true,
    });
    expect(service.listStates([platformMeta, mindmapMeta])).toEqual([
      { meta: platformMeta, state: 'enabled' },
      { meta: mindmapMeta, state: 'missing', reason: '用户已卸载该插件' },
    ]);

    service.setInstalled('mindmap', true, [platformMeta, mindmapMeta]);
    expect(service.getInstalledRecord('mindmap')).toMatchObject({
      installed: true,
      userRemoved: false,
    });
  });

  it('禁止禁用或卸载 required 插件', () => {
    service.ensureBuiltinInstalled([platformMeta]);

    expect(() => service.setEnabled('platform', false)).toThrow('核心插件不能禁用');
    expect(() => service.setInstalled('platform', false)).toThrow('核心插件不能卸载');
    expect(service.listStates([platformMeta])).toEqual([{ meta: platformMeta, state: 'enabled' }]);
  });

  it('启用或安装插件前要求依赖已安装且已启用', () => {
    service.ensureBuiltinInstalled([platformMeta, sheetMeta, sheetAutomationMeta]);
    service.setEnabled('sheet-automation', false, [platformMeta, sheetMeta, sheetAutomationMeta]);
    service.setEnabled('sheet', false, [platformMeta, sheetMeta, sheetAutomationMeta]);

    expect(() =>
      service.setEnabled('sheet-automation', true, [platformMeta, sheetMeta, sheetAutomationMeta])
    ).toThrow('插件依赖未满足');

    service.setInstalled('sheet-automation', false, [platformMeta, sheetMeta, sheetAutomationMeta]);
    expect(() =>
      service.setInstalled('sheet-automation', true, [platformMeta, sheetMeta, sheetAutomationMeta])
    ).toThrow('插件依赖未满足');
  });

  it('禁用或卸载被依赖插件时拒绝操作并返回依赖者', () => {
    service.ensureBuiltinInstalled([platformMeta, sheetMeta, sheetAutomationMeta]);

    expect(() =>
      service.setEnabled('sheet', false, [platformMeta, sheetMeta, sheetAutomationMeta])
    ).toThrow('sheet-automation');
    expect(() =>
      service.setInstalled('sheet', false, [platformMeta, sheetMeta, sheetAutomationMeta])
    ).toThrow('sheet-automation');
  });

  it('required 插件即使被标记 missing，重启式登记也会恢复安装和启用', () => {
    service.ensureBuiltinInstalled([platformMeta]);
    db.prepare('UPDATE installed_plugins SET installed = 0 WHERE plugin_id = ?').run('platform');
    db.prepare('DELETE FROM enabled_plugins WHERE plugin_id = ?').run('platform');

    service.ensureBuiltinInstalled([platformMeta]);

    expect(service.listStates([platformMeta])).toEqual([{ meta: platformMeta, state: 'enabled' }]);
  });
});
