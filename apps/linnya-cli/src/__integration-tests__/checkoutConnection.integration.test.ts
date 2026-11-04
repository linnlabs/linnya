import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_CONTROL_CONNECTION_FILE_NAME } from '@app/schemas';
import { readSourceCheckoutIdentity } from '../../../../src/shared/runtime-paths/functions/readSourceCheckoutIdentity';
import { resolveCliSourceCheckout } from '../functions/resolveCliSourceCheckout';
import { resolveConnectionFile } from '../functions/resolveConnectionFile';
import { createConversationControlConnection } from '../orchestration/createConversationControlConnection';
import {
  cleanupCliBridges,
  createScriptedBridge,
  runCliProcess,
} from './__test-helpers__/scriptedCliBridge';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupCliBridges();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function checkout() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-checkout-'));
  roots.push(temporary);
  const root = await fs.realpath(temporary);
  await fs.mkdir(path.join(root, 'apps/linnya-cli/src'), { recursive: true });
  await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages: []');
  const entry = path.join(root, 'apps/linnya-cli/src/main.ts');
  await fs.writeFile(entry, '');
  const identity = resolveCliSourceCheckout(entry);
  if (!identity) throw new Error('Missing fixture identity');
  return { root, entry, identity };
}

describe('source checkout connection over real HTTP', () => {
  it('默认连接本目录；符号链接归一后仍是同一源码身份', async () => {
    vi.stubEnv('LINNYA_CLI_CONNECTION_FILE', undefined);
    const source = await checkout();
    const link = path.join(source.root, 'checkout-link');
    await fs.symlink(source.root, link, 'junction');
    expect(resolveCliSourceCheckout(path.join(link, 'apps/linnya-cli/src/main.ts'))).toEqual(
      source.identity
    );
    const bridge = await createScriptedBridge(
      () => ({
        schema_version: 1,
        ok: true,
        command: 'audit_level',
        level: 'off',
      }),
      undefined,
      { kind: 'source', source_root: source.root, branch: 'feature', audit_level: 'off' }
    );
    const local = resolveConnectionFile({}, undefined, source.identity);
    expect(local).toBe(
      path.join(source.root, '_dev_electron/runtime', CONVERSATION_CONTROL_CONNECTION_FILE_NAME)
    );
    await fs.mkdir(path.dirname(local), { recursive: true });
    await fs.copyFile(bridge.connectionFile, local);
    const client = await createConversationControlConnection({
      sourceCheckout: source.identity,
    }).connect();
    // 分支只用于显示，不能替代真实目录身份。
    expect(client.handshake.instance).toMatchObject({
      source_root: source.root,
      branch: 'feature',
    });
    expect(await client.execute({ schema_version: 1, command: 'audit_level' })).toMatchObject({
      level: 'off',
    });
  });

  it('一次性实例连接路径与 Desktop 一致，显式连接覆盖优先', async () => {
    const source = await checkout();
    expect(resolveConnectionFile({ LINNYA_DEV_INSTANCE_ROOT: './disposable' }, undefined, source.identity))
      .toBe(path.join(source.root, 'disposable/_dev_electron/runtime', CONVERSATION_CONTROL_CONNECTION_FILE_NAME));
    const explicit = path.join(source.root, 'explicit.json');
    expect(resolveConnectionFile({ LINNYA_DEV_INSTANCE_ROOT: './disposable',
      LINNYA_CLI_CONNECTION_FILE: explicit }, undefined, source.identity)).toBe(explicit);
  });

  it('本目录未启动，即使用户级安装版连接有效也不回退', async () => {
    const source = await checkout();
    const home = path.join(source.root, 'home');
    const bridge = await createScriptedBridge(() => {
      throw new Error('must not connect');
    });
    const userFile = resolveConnectionFile({}, home, null);
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.copyFile(bridge.connectionFile, userFile);
    vi.stubEnv('HOME', home);
    vi.stubEnv('LINNYA_CLI_CONNECTION_FILE', undefined);
    const fetchSpy = vi.fn(fetch);
    await expect(
      createConversationControlConnection({
        sourceCheckout: source.identity,
        fetchImplementation: fetchSpy,
      }).connect()
    ).rejects.toMatchObject({
      code: 'app_not_running',
      connection: { source_root: source.root, state: 'not_connected', instance: null },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('显式环境变量也不能跨目录；真实 CLI 错误显示双方身份且未执行命令', async () => {
    const source = await checkout();
    const bridge = await createScriptedBridge(
      () => {
        throw new Error('must not execute');
      },
      undefined,
      { kind: 'source', source_root: source.root, branch: 'other', audit_level: 'stream' }
    );
    const result = await runCliProcess(['audit', 'level', 'behavior'], bridge.connectionFile);
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: 'source_mismatch', message: expect.stringContaining(source.root) },
      connection: {
        source_root: readSourceCheckoutIdentity(path.resolve(import.meta.dirname, '../../../..'))
          .root,
        state: 'rejected',
        instance: { source_root: source.root, branch: 'other', audit_level: 'stream' },
      },
    });
    expect(bridge.receivedCommands).toEqual([]);
  });

  it('源码 CLI 拒绝显式指向安装版', async () => {
    const bridge = await createScriptedBridge(() => null, undefined, {
      kind: 'packaged',
      source_root: null,
      branch: null,
      audit_level: 'off',
    });
    const result = await runCliProcess(['doctor'], bridge.connectionFile);
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: 'source_mismatch', message: expect.stringContaining('安装版') },
      connection: { state: 'rejected', instance: { kind: 'packaged' } },
    });
  });
});
