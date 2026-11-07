import { describe, expect, it } from 'vitest';

import { AppServerStartupFailedError } from '../../../infra/adapters/app-server-process';
import type {
  StartupFailureDialogContext,
  StartupFailureMessageBoxOptions,
} from '../definitions/startupFailureDialog';
import { describeStartupFailureDialog } from '../functions/describeStartupFailureDialog';
import { presentStartupFailureDialog } from './presentStartupFailureDialog';

const CONTEXT: StartupFailureDialogContext = {
  locale: 'zh-CN',
  applicationVersion: '0.2.0',
  distributionKind: 'official',
  platform: 'darwin',
  osRelease: '25.6.0',
  arch: 'arm64',
  dataDirectory: '/Users/someone/Library/Application Support/Linnya/Workspace',
  homeDirectory: '/Users/someone',
};

function scriptedPort(responses: readonly number[]) {
  const shown: StartupFailureMessageBoxOptions[] = [];
  const copied: string[] = [];
  let index = 0;
  return {
    shown,
    copied,
    port: {
      async showMessageBox(options: StartupFailureMessageBoxOptions) {
        shown.push(options);
        const response = responses[index] ?? 2;
        index += 1;
        return { response };
      },
      writeClipboardText(text: string) {
        copied.push(text);
      },
    },
  };
}

describe('启动失败对话框', () => {
  it('按类别说明原因；复制诊断后重新显示，并提示已复制', async () => {
    const error = new AppServerStartupFailedError('database or disk is full', {
      reason: 'disk_full',
      code: 'SQLITE_FULL',
      migration_from_version: null,
    });
    const { port, shown, copied } = scriptedPort([1, 2]);

    await expect(presentStartupFailureDialog({ error, context: CONTEXT, port })).resolves.toBe('quit');

    expect(shown).toHaveLength(2);
    expect(shown[0]).toMatchObject({
      type: 'error',
      title: 'Linnya 启动失败',
      message: '磁盘空间不足，Linnya 无法启动',
      buttons: ['重新启动', '复制诊断信息', '退出'],
      defaultId: 0,
      cancelId: 2,
    });
    expect(shown[0]?.detail).toBe('请释放磁盘空间，然后重新启动。');
    expect(shown[1]?.detail.startsWith('诊断信息已复制。')).toBe(true);
    expect(copied).toEqual([
      [
        'Linnya startup diagnostics',
        'version: 0.2.0 (official)',
        'os: darwin 25.6.0 arm64',
        'reason: disk_full',
        'code: SQLITE_FULL',
        'migration: none',
        'data: ~/Library/Application Support/Linnya/Workspace',
        'error: App Server startup_failed: database or disk is full',
      ].join('\n'),
    ]);
  });

  it('选择重新启动时返回 restart', async () => {
    const error = new AppServerStartupFailedError('busy', {
      reason: 'busy',
      code: 'SQLITE_BUSY',
      migration_from_version: null,
    });
    const { port } = scriptedPort([0]);
    await expect(presentStartupFailureDialog({ error, context: CONTEXT, port })).resolves.toBe('restart');
  });

  it('迁移失败如实说明停在哪一步，不声称数据没有改动', () => {
    const view = describeStartupFailureDialog({
      failure: { reason: 'migration_failed', code: 'SQLITE_ERROR', migration_from_version: 70 },
      errorMessage: 'Database migration failed at v70 -> v71',
      context: CONTEXT,
    });
    expect(view.headline).toBe('数据升级没有完成');
    expect(view.detail).toContain('v70 → v71');
    expect(view.detail).toContain('这一步已经回滚，之前完成的步骤保留');
    expect(view.detail).not.toContain('没有改动');
    expect(view.diagnostics).toContain('migration: v70 -> v71');
  });

  it('只有版本准入拒绝时才说原数据没有改动', () => {
    const newer = describeStartupFailureDialog({
      failure: { reason: 'newer_data', code: null, migration_from_version: null },
      errorMessage: 'newer',
      context: CONTEXT,
    });
    const corrupt = describeStartupFailureDialog({
      failure: { reason: 'corrupt', code: 'SQLITE_NOTADB', migration_from_version: null },
      errorMessage: 'file is not a database',
      context: CONTEXT,
    });
    expect(newer.detail.startsWith('原数据没有改动。')).toBe(true);
    expect(corrupt.detail).not.toContain('没有改动');
    expect(corrupt.detail).toContain('不要删除、移动或覆盖数据目录');
  });

  it('Main 自身的启动失败没有类别：按原因未知说明，附上错误文案并把主目录写成 ~', async () => {
    const error = new Error('cannot read /Users/someone/Library/models.json');
    const { port, shown, copied } = scriptedPort([1, 2]);
    await presentStartupFailureDialog({ error, context: CONTEXT, port });
    expect(shown[0]?.message).toBe('Linnya 启动失败');
    expect(shown[0]?.detail).toContain('错误：cannot read ~/Library/models.json');
    expect(copied[0]).toContain('reason: unknown');
    expect(copied[0]).not.toContain('/Users/someone');
  });

  it('英文系统使用英文文案', () => {
    const view = describeStartupFailureDialog({
      failure: { reason: 'corrupt', code: 'SQLITE_CORRUPT', migration_from_version: null },
      errorMessage: 'database disk image is malformed',
      context: { ...CONTEXT, locale: 'en-US' },
    });
    expect(view.title).toBe('Linnya could not start');
    expect(view.headline).toBe('The data file is damaged');
    expect(view.buttons).toEqual(['Restart', 'Copy Diagnostics', 'Quit']);
  });
});
