import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCommandPermissionSettings, updateCommandPermissionSettings } from 'src/domains/commands';
import { createCommandPermissionSettingsAuthority } from '../../commands/permission-settings-authority';
import { createExternalCommandApprovalPort } from '../orchestration/createExternalCommandApprovalPort';

describe('命令权限设置（真实文件与内存权威）→ 外部命令行能否代批', () => {
  let root: string;
  let settingsPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'linnya-external-approval-'));
    settingsPath = path.join(root, 'config', 'command_permission.json');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const createAuthority = () => createCommandPermissionSettingsAuthority({
    settingsPath, initializationMarkerPath: `${settingsPath}.initialized`,
  });

  it('新安装默认只有用户能批；用户在桌面端打开后立即可代批；运行中改磁盘文件不生效', async () => {
    const settings = createAuthority();
    const desktop = createExternalCommandApprovalPort({ hostKind: 'desktop', hostAllows: false, settings });
    expect(desktop.read()).toEqual({ permitted: false, host: 'desktop' });

    // 同一系统用户下的进程（包括外部 Agent 自己）能改这个文件，但本次运行只认内存里的设置。
    const onDisk: unknown = JSON.parse(await readFile(settingsPath, 'utf8'));
    await writeFile(settingsPath, JSON.stringify({ ...(onDisk as object), external_command_approval: 'allowed' }));
    expect(desktop.read()).toEqual({ permitted: false, host: 'desktop' });

    // 桌面端设置通道走的就是这条更新；成功后下一次查询立刻放开，不需要重启。
    const current = readCommandPermissionSettings(settings);
    updateCommandPermissionSettings({ port: settings, update: {
      schema_version: 1, kind: 'command_permission_settings_update', expected_revision: current.revision,
      permission_level: current.permission_level, internal_data_access: current.internal_data_access,
      external_command_approval: 'allowed',
    } });
    expect(desktop.read()).toEqual({ permitted: true });

    // 关上同样即时生效；重启后沿用上次保存的值。
    updateCommandPermissionSettings({ port: settings, update: {
      schema_version: 1, kind: 'command_permission_settings_update', expected_revision: current.revision + 1,
      permission_level: current.permission_level, internal_data_access: current.internal_data_access,
      external_command_approval: 'user_only',
    } });
    expect(desktop.read()).toEqual({ permitted: false, host: 'desktop' });
    expect(createExternalCommandApprovalPort({ hostKind: 'desktop', hostAllows: false, settings: createAuthority() }).read())
      .toEqual({ permitted: false, host: 'desktop' });
  });

  it('无界面运行时：缺省归因到它自己；启动时放行则不看设置', () => {
    const settings = createAuthority();
    expect(createExternalCommandApprovalPort({ hostKind: 'cli_runtime', hostAllows: false, settings }).read())
      .toEqual({ permitted: false, host: 'cli_runtime' });
    expect(createExternalCommandApprovalPort({ hostKind: 'cli_runtime', hostAllows: true, settings }).read())
      .toEqual({ permitted: true });
  });

  it('设置文件损坏时按未放开处理，不抛到控制入口', async () => {
    createAuthority();
    await writeFile(settingsPath, '{');
    const broken = createAuthority();
    expect(createExternalCommandApprovalPort({ hostKind: 'desktop', hostAllows: false, settings: broken }).read())
      .toEqual({ permitted: false, host: 'desktop' });
  });
});
