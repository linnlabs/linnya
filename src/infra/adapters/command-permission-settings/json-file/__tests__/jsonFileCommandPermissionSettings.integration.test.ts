import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  readCommandPermissionSettings,
  serializeCommandPermissionSettings,
  updateCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import { createJsonFileCommandPermissionSettingsPort } from '..';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-command-permission-中文 path-'));
  roots.push(root);
  const filePath = path.join(root, 'nested config', 'command_permission.json');
  return {
    root,
    filePath,
    port: createJsonFileCommandPermissionSettingsPort({ filePath }),
  };
}

describe('json file command permission settings adapter', () => {
  it('完整文档原子替换后可以由新 adapter 实例恢复', async () => {
    const fixture = await createFixture();
    expect(fixture.port.write(serializeCommandPermissionSettings(
      DEFAULT_COMMAND_PERMISSION_SETTINGS,
    ))).toEqual({ status: 'written' });
    const updated = updateCommandPermissionSettings({
      port: fixture.port,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'full_access',
        internal_data_access: 'denied',
      },
    });
    const restored = readCommandPermissionSettings(
      createJsonFileCommandPermissionSettingsPort({ filePath: fixture.filePath }),
    );
    expect(restored).toEqual(updated);
    expect((await fsp.readdir(path.dirname(fixture.filePath))).filter(
      entry => entry.endsWith('.tmp'),
    )).toEqual([]);
  });

  it('正式文件损坏时保留现场并明确失败', async () => {
    const fixture = await createFixture();
    await fsp.mkdir(path.dirname(fixture.filePath), { recursive: true });
    await fsp.writeFile(fixture.filePath, '{not-json', 'utf8');
    expect(() => readCommandPermissionSettings(fixture.port)).toThrow(
      expect.objectContaining({ code: 'invalid_config' }),
    );
    expect(await fsp.readFile(fixture.filePath, 'utf8')).toBe('{not-json');
  });

  it('存储路径不可写时返回稳定 write_failed，不伪造已保存状态', async () => {
    const fixture = await createFixture();
    const blockingParent = path.join(fixture.root, 'parent-is-file');
    await fsp.writeFile(blockingParent, 'file', 'utf8');
    const blockedPort = createJsonFileCommandPermissionSettingsPort({
      filePath: path.join(blockingParent, 'command_permission.json'),
    });
    expect(() => updateCommandPermissionSettings({
      port: {
        read: () => ({
          status: 'found',
          serialized: serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS),
        }),
        write: serialized => blockedPort.write(serialized),
      },
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'read_only',
        internal_data_access: 'allowed',
      },
    })).toThrow(expect.objectContaining({ code: 'write_failed' }));
    expect(await fsp.readFile(blockingParent, 'utf8')).toBe('file');
  });
});
