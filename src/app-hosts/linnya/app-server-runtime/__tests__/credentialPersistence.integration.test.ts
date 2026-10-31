import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileCredentialStorage } from '../../../../infra/adapters/credential-storage/file/createFileCredentialStorage';
import { EndpointCredentialStore } from '../../../../domains/model-catalog/features/inference-endpoints/orchestration/endpointCredentialStore';
import { FileProviderAccountRegistry } from '../../../../domains/provider-account/features/account-persistence/orchestration/fileProviderAccountRegistry';
import { createStoredPluginCredentialRuntimePort } from '../../adapters/plugin-credentials/createStoredPluginCredentialRuntimePort';
import { CredentialStorageError } from '../../../../shared/credential-storage';

const account = {
  id: 'subscription',
  provider_connection_definition_id: 'openai-chatgpt-subscription',
  auth_method: 'oauth_pkce' as const,
};
const credential = {
  access_token: 'access-secret',
  refresh_token: 'refresh-secret',
  expires_at: 1_900_000_000_000,
  account_id: 'account-fixture',
};
let root: string;
let filePath: string;

function open() {
  const storage = createFileCredentialStorage(filePath);
  const endpoints = new EndpointCredentialStore();
  endpoints.installStorage(storage);
  const accounts = new FileProviderAccountRegistry();
  accounts.installCredentialStorage(storage);
  const plugins = createStoredPluginCredentialRuntimePort(storage);
  return { storage, endpoints, accounts, plugins };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-credentials-'));
  filePath = path.join(root, 'profile', 'config', 'credentials.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('App Server 统一文件凭据业务', () => {
  it('模型、OAuth、多个插件并发保存后重启恢复，状态 DTO 不包含 secret', async () => {
    const first = open();
    await first.endpoints.initialize();
    await first.accounts.initialize();
    await Promise.all([
      first.endpoints.put('endpoint', 'model-secret'),
      first.accounts.putOAuthCredential(account, credential),
      first.plugins.write('a', { API_KEY: ' plugin-a-secret ' }),
      first.plugins.write('b', { API_KEY: 'plugin-b-secret' }),
    ]);
    const restarted = open();
    expect(restarted.endpoints.resolve('endpoint')).toBe('model-secret');
    expect(restarted.accounts.resolveOAuthCredential(account.id)).toEqual(credential);
    expect(JSON.stringify(restarted.accounts.list())).not.toContain('secret');
    await expect(restarted.plugins.read('a', 'API_KEY')).resolves.toBe('plugin-a-secret');
    await expect(restarted.plugins.listStatus('b', ['API_KEY', 'MISSING'])).resolves.toEqual([
      { key: 'API_KEY', configured: true },
      { key: 'MISSING', configured: false },
    ]);
    if (process.platform !== 'win32') expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp'))).toEqual(
      []
    );
  });

  it('多个文件 owner 不用旧快照重写其他记录；OAuth 刷新、删除和端点回滚各自独立', async () => {
    const first = open();
    const second = open();
    await first.endpoints.put('endpoint', 'before');
    const rollback = first.endpoints.captureRollback('endpoint');
    await first.endpoints.put('endpoint', 'after');
    await second.accounts.putOAuthCredential(account, credential);
    const createdAt = second.accounts.get(account.id)?.created_at;
    await second.accounts.putOAuthCredential(account, {
      ...credential,
      access_token: 'refreshed',
      refresh_token: 'rotated',
    });
    await second.plugins.write('a', { API_KEY: 'plugin-a', TOKEN: 'retained' });
    await rollback();
    expect(first.endpoints.resolve('endpoint')).toBe('before');
    expect(first.accounts.resolveOAuthCredential(account.id).refresh_token).toBe('rotated');
    expect(first.accounts.get(account.id)?.created_at).toBe(createdAt);
    await first.endpoints.remove('endpoint');
    await first.plugins.write('a', { API_KEY: null });
    expect(second.endpoints.getStatus('endpoint')).toBe('missing');
    await expect(second.plugins.read('a', 'API_KEY')).resolves.toBeUndefined();
    await expect(second.plugins.read('a', 'TOKEN')).resolves.toBe('retained');
    await second.accounts.remove(account.id);
    expect(first.accounts.list()).toEqual([]);
  });

  it.each([
    '{"secret":"do-not-log",',
    '{"version":999,"namespaces":{}}',
    '{"version":1,"namespaces":[]}',
  ])('文件损坏后保留原件，读取与继续保存均失败且错误不含文件片段', async broken => {
    const owner = open();
    await owner.endpoints.put('endpoint', 'original');
    fs.writeFileSync(filePath, broken);
    expect(() => owner.endpoints.resolve('endpoint')).toThrow(CredentialStorageError);
    await expect(owner.plugins.write('a', { API_KEY: 'new' })).rejects.toThrow('保留原文件');
    await expect(owner.endpoints.put('endpoint', 'new')).rejects.not.toThrow('do-not-log');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(broken);
    expect(() => open()).toThrow('保留原文件');
  });

  it('读不到已有文件不当作首次启动；修复后需要新 owner，不能沿失败状态继续保存', async () => {
    const owner = open();
    await owner.endpoints.put('endpoint', 'original');
    const original = fs.readFileSync(filePath);
    fs.renameSync(filePath, `${filePath}.backup`);
    await expect(owner.endpoints.put('endpoint', 'new')).rejects.toThrow('保留原文件');
    fs.writeFileSync(filePath, original);
    await expect(owner.endpoints.put('endpoint', 'new')).rejects.toThrow('保留原文件');
    expect(open().endpoints.resolve('endpoint')).toBe('original');
  });

  it('原子替换失败不改变凭据或配置状态，清理临时文件后可再次提交', async () => {
    const owner = open();
    await owner.accounts.putOAuthCredential(account, credential);
    const original = fs.readFileSync(filePath, 'utf8');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('fixture rename failure');
    });
    await expect(
      owner.accounts.putOAuthCredential(account, { ...credential, access_token: 'uncommitted' })
    ).rejects.toThrow('原文件未被替换');
    expect(owner.accounts.resolveOAuthCredential(account.id)).toEqual(credential);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp'))).toEqual(
      []
    );
    rename.mockRestore();
    await owner.accounts.putOAuthCredential(account, { ...credential, access_token: 'committed' });
    expect(open().accounts.resolveOAuthCredential(account.id).access_token).toBe('committed');
  });

  it('真实并发进程合并记录；写入中退出留下的私有临时文件不会被当成正式凭据', async () => {
    const execute = promisify(execFile);
    const fixture = path.resolve(
      'src/infra/adapters/credential-storage/file/__fixtures__/credentialWriter.ts'
    );
    const run = (writer: string, mode = 'write') =>
      execute(process.execPath, ['--import', 'tsx', fixture, filePath, writer, mode]);
    await Promise.all([run('first'), run('second')]);
    const owner = open();
    expect(owner.storage.read('fixture').size).toBe(40);
    const original = fs.readFileSync(filePath, 'utf8');
    await expect(run('crashed', 'crash')).rejects.toMatchObject({ code: 78 });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    const abandoned = fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp'));
    expect(abandoned).toHaveLength(1);
    if (process.platform !== 'win32')
      expect(fs.statSync(path.join(path.dirname(filePath), abandoned[0])).mode & 0o777).toBe(0o600);
    await owner.endpoints.put('after-crash', 'new-value');
    expect(open().storage.read('fixture').size).toBe(40);
    expect(open().endpoints.resolve('after-crash')).toBe('new-value');
  });

  it('业务记录格式损坏时不允许替换，旧凭据文件不会被导入', async () => {
    const owner = open();
    await owner.storage.update('model-endpoints', new Map([['bad', { secret: 'wrong-shape' }]]));
    const original = fs.readFileSync(filePath, 'utf8');
    await expect(owner.endpoints.initialize()).rejects.toThrow('保留原文件');
    await expect(owner.endpoints.put('bad', 'overwrite')).rejects.toThrow('保留原文件');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    fs.writeFileSync(
      path.join(root, 'profile', 'config', 'plugin_credentials.json'),
      'old-invalid-file'
    );
    await expect(owner.plugins.read('old-plugin', 'API_KEY')).resolves.toBeUndefined();
  });
});
