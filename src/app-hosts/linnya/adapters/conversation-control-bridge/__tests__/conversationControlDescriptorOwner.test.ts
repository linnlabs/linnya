import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationControlConnectionDescriptorSchema } from '@app/schemas';
import { resolveConversationControlConnectionFile } from '../functions/resolveConversationControlConnectionFile';
import { createConversationControlDescriptorOwner } from '../orchestration/createConversationControlDescriptorOwner';

const temporaryRoots: string[] = [];

async function createTemporaryConnectionFile(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-bridge-'));
  temporaryRoots.push(root);
  return path.join(root, 'private', 'conversation-control-v1.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('conversation-control descriptor owner', () => {
  it('原子发布严格连接描述，并按当前 App 实例撤销', async () => {
    const connectionFile = await createTemporaryConnectionFile();
    const owner = createConversationControlDescriptorOwner({
      connectionFile,
      appInstanceId: 'app-instance-1',
      sessionToken: 'a'.repeat(64),
      pid: 42,
      now: () => 100,
    });

    await owner.publish(43123);
    const descriptor = ConversationControlConnectionDescriptorSchema.parse(
      JSON.parse(await fs.readFile(connectionFile, 'utf8')),
    );
    expect(descriptor).toMatchObject({
      app_instance_id: 'app-instance-1',
      port: 43123,
      session_token: 'a'.repeat(64),
      created_at: 100,
      updated_at: 100,
    });

    if (process.platform !== 'win32') {
      expect((await fs.stat(connectionFile)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(connectionFile))).mode & 0o777).toBe(0o700);
    }
    await expect(owner.revoke()).resolves.toBe(true);
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('旧 App owner 不删除后来实例发布的连接描述', async () => {
    const connectionFile = await createTemporaryConnectionFile();
    const first = createConversationControlDescriptorOwner({
      connectionFile,
      appInstanceId: 'app-instance-old',
      sessionToken: 'a'.repeat(64),
      pid: 41,
    });
    const current = createConversationControlDescriptorOwner({
      connectionFile,
      appInstanceId: 'app-instance-current',
      sessionToken: 'b'.repeat(64),
      pid: 42,
    });
    await first.publish(43122);
    await current.publish(43123);

    await expect(first.revoke()).resolves.toBe(false);
    expect(ConversationControlConnectionDescriptorSchema.parse(
      JSON.parse(await fs.readFile(connectionFile, 'utf8')),
    ).app_instance_id).toBe('app-instance-current');
  });

  it('连接文件支持显式覆盖，并有跨进程一致的用户级默认路径', () => {
    expect(resolveConversationControlConnectionFile(
      { LINNYA_CLI_CONNECTION_FILE: './test-runtime/bridge.json' },
      '/unused-home',
    )).toBe(path.resolve('./test-runtime/bridge.json'));
    expect(resolveConversationControlConnectionFile({}, '/users/linnya')).toBe(
      path.join('/users/linnya', '.linnya', 'runtime', 'conversation-control-v1.json'),
    );
  });
});
