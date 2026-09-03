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
import { createCommandPermissionSettingsAuthority } from '../orchestration/createCommandPermissionSettingsAuthority';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function createPaths() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-permission-authority-'));
  roots.push(root);
  return {
    root,
    settingsPath: path.join(root, 'settings', 'command-permission.json'),
    initializationMarkerPath: path.join(root, 'settings', 'command-permission.initialized'),
  };
}

describe('command permission settings authority', () => {
  it('首次创建默认配置，运行中忽略外部改写，并只在 UI 更新持久化成功后换快照', async () => {
    const paths = await createPaths();
    const authority = createCommandPermissionSettingsAuthority(paths);

    expect(readCommandPermissionSettings(authority)).toEqual(DEFAULT_COMMAND_PERMISSION_SETTINGS);
    await expect(fsp.readFile(paths.initializationMarkerPath, 'utf8')).resolves.toContain(
      'command_permission_settings_initialized_v1',
    );

    await fsp.writeFile(paths.settingsPath, serializeCommandPermissionSettings({
      ...DEFAULT_COMMAND_PERMISSION_SETTINGS,
      revision: 99,
      permission_level: 'full_access',
    }), 'utf8');
    expect(readCommandPermissionSettings(authority)).toEqual(DEFAULT_COMMAND_PERMISSION_SETTINGS);

    const updated = updateCommandPermissionSettings({
      port: authority,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'read_only',
        internal_data_access: 'denied',
      },
    });
    expect(readCommandPermissionSettings(authority)).toEqual(updated);
    expect(JSON.parse(await fsp.readFile(paths.settingsPath, 'utf8'))).toEqual(updated);
  });

  it('已初始化后的配置缺失明确不可用，不重新生成 standard', async () => {
    const paths = await createPaths();
    await fsp.mkdir(path.dirname(paths.initializationMarkerPath), { recursive: true });
    await fsp.writeFile(
      paths.initializationMarkerPath,
      'command_permission_settings_initialized_v1\n',
      'utf8',
    );

    const authority = createCommandPermissionSettingsAuthority(paths);
    expect(authority.read()).toEqual({
      status: 'failed',
      message: '命令权限设置在完成初始化后缺失。',
    });
    await expect(fsp.stat(paths.settingsPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('已有配置升级时补建初始化标记但不改写用户权限', async () => {
    const paths = await createPaths();
    const existing = {
      ...DEFAULT_COMMAND_PERMISSION_SETTINGS,
      revision: 7,
      permission_level: 'read_only' as const,
      internal_data_access: 'denied' as const,
    };
    await fsp.mkdir(path.dirname(paths.settingsPath), { recursive: true });
    await fsp.writeFile(
      paths.settingsPath,
      serializeCommandPermissionSettings(existing),
      'utf8',
    );

    const authority = createCommandPermissionSettingsAuthority(paths);
    expect(readCommandPermissionSettings(authority)).toEqual(existing);
    await expect(fsp.readFile(paths.initializationMarkerPath, 'utf8')).resolves.toContain(
      'command_permission_settings_initialized_v1',
    );
  });

  it('运行期更新只提交配置与内存，初始化标记异常不制造两份 revision', async () => {
    const fixture = await createPaths();
    const markerParent = path.join(fixture.root, 'independent-marker');
    const paths = {
      settingsPath: fixture.settingsPath,
      initializationMarkerPath: path.join(markerParent, 'permission.initialized'),
    };
    const authority = createCommandPermissionSettingsAuthority(paths);
    await fsp.rm(paths.initializationMarkerPath);
    await fsp.rm(markerParent, { recursive: true });
    await fsp.writeFile(markerParent, 'not-a-directory', 'utf8');

    const updated = updateCommandPermissionSettings({
      port: authority,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'full_access',
        internal_data_access: 'denied',
      },
    });

    expect(readCommandPermissionSettings(authority)).toEqual(updated);
    expect(JSON.parse(await fsp.readFile(paths.settingsPath, 'utf8'))).toEqual(updated);
    await expect(fsp.stat(paths.initializationMarkerPath)).rejects.toMatchObject({ code: 'ENOTDIR' });

    const restored = createCommandPermissionSettingsAuthority(paths);
    expect(restored.read()).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('初始化标记'),
    });

    // 标记路径恢复后，下一次启动补建标记并读取唯一持久 revision。
    await fsp.rm(markerParent);
    const restarted = createCommandPermissionSettingsAuthority(paths);
    expect(readCommandPermissionSettings(restarted)).toEqual(updated);
    await expect(fsp.readFile(paths.initializationMarkerPath, 'utf8')).resolves.toContain(
      'command_permission_settings_initialized_v1',
    );
  });

  it('损坏的初始化标记不能冒充已初始化事实', async () => {
    const paths = await createPaths();
    await fsp.mkdir(path.dirname(paths.settingsPath), { recursive: true });
    await Promise.all([
      fsp.writeFile(
        paths.settingsPath,
        serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS),
        'utf8',
      ),
      fsp.writeFile(paths.initializationMarkerPath, 'unexpected-marker\n', 'utf8'),
    ]);

    const authority = createCommandPermissionSettingsAuthority(paths);
    expect(authority.read()).toEqual({
      status: 'failed',
      message: '命令权限设置初始化标记内容无效。',
    });
  });
});
