import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
  CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  ConversationDirectoryError,
  createConversationWorkDirectoryOwnerMarker,
  deleteConversationDirectoryIdentityMetadata,
  deleteConversationWorkDirectory,
  deriveConversationWorkDirectoryIdentity,
  resolveConversationWorkDirectory,
} from '../../../../../domains/conversation-files';
import { createLocalConversationDirectoryPort } from '../createLocalConversationDirectoryPort';

const testRoots: string[] = [];

async function createTestRoot(label: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-${label}-中文 path-`));
  testRoots.push(root);
  return root;
}

function resolveOwnerMarkerPath(
  storageRoot: string,
  conversationId: string,
): string {
  const identity = deriveConversationWorkDirectoryIdentity(conversationId);
  return path.join(
    storageRoot,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
    `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX}`,
  );
}

function resolveInitializedMarkerPath(
  storageRoot: string,
  conversationId: string,
): string {
  const identity = deriveConversationWorkDirectoryIdentity(conversationId);
  return path.join(
    storageRoot,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
    `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX}`,
  );
}

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('Conversation work directory identity and local storage', () => {
  it('跨恢复保持同一路径，并隔离会被普通路径清理合并的对话身份', async () => {
    const storageRoot = await createTestRoot('identity');
    const firstPort = createLocalConversationDirectoryPort({ storageRoot });

    const slash = await resolveConversationWorkDirectory({
      conversationId: 'conversation/a',
      directoryPort: firstPort,
    });
    const question = await resolveConversationWorkDirectory({
      conversationId: 'conversation?a',
      directoryPort: firstPort,
    });
    const unicode = await resolveConversationWorkDirectory({
      conversationId: '对话-一',
      directoryPort: firstPort,
    });
    const backslash = await resolveConversationWorkDirectory({
      conversationId: 'conversation\\a',
      directoryPort: firstPort,
    });
    const longPrefixA = await resolveConversationWorkDirectory({
      conversationId: `${'long-prefix-'.repeat(300)}a`,
      directoryPort: firstPort,
    });
    const longPrefixB = await resolveConversationWorkDirectory({
      conversationId: `${'long-prefix-'.repeat(300)}b`,
      directoryPort: firstPort,
    });

    expect(slash.status).toBe('created');
    expect(question.status).toBe('created');
    expect(unicode.status).toBe('created');
    expect(new Set([
      slash.absolutePath,
      question.absolutePath,
      unicode.absolutePath,
      backslash.absolutePath,
      longPrefixA.absolutePath,
      longPrefixB.absolutePath,
    ]).size).toBe(6);
    expect(slash.absolutePath).not.toContain('conversation/a');
    expect(unicode.absolutePath).not.toContain('对话-一');
    expect(await fsp.readdir(slash.absolutePath)).toEqual([]);

    await fsp.writeFile(path.join(slash.absolutePath, 'kept.txt'), 'persisted', 'utf8');
    const restartedPort = createLocalConversationDirectoryPort({ storageRoot });
    const restored = await resolveConversationWorkDirectory({
      conversationId: 'conversation/a',
      directoryPort: restartedPort,
    });

    expect(restored.status).toBe('existing');
    expect(restored.absolutePath).toBe(slash.absolutePath);
    await expect(fsp.readFile(path.join(restored.absolutePath, 'kept.txt'), 'utf8'))
      .resolves.toBe('persisted');
  });

  it('并发取得同一 conversation 时只发布一个目录并共享身份', async () => {
    const storageRoot = await createTestRoot('concurrent');

    // 使用多个 adapter 模拟两个 App 进程或重入 owner，验证磁盘发布本身也不会覆盖已发布目录。
    const results = await Promise.all(Array.from({ length: 24 }, () => (
      resolveConversationWorkDirectory({
        conversationId: 'conv-concurrent',
        directoryPort: createLocalConversationDirectoryPort({ storageRoot }),
      })
    )));

    expect(new Set(results.map(result => result.absolutePath)).size).toBe(1);
    expect(results.some(result => result.status === 'created')).toBe(true);
    expect(results.every(result => (
      result.status === 'created' || result.status === 'existing'
    ))).toBe(true);
    const entries = await fsp.readdir(results[0].absolutePath);
    expect(entries).toEqual([]);
    const metadataRoot = path.join(
      storageRoot,
      CONVERSATION_WORK_DIRECTORY_NAMESPACE,
      'v1',
      CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
    );
    expect((await fsp.readdir(metadataRoot)).filter(entry => entry.includes('.tmp-')))
      .toEqual([]);
  });

  it('同一 adapter 的并发调用共享一次生命周期结果，不重复初始化', async () => {
    const storageRoot = await createTestRoot('single-port-concurrent');
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });

    const results = await Promise.all(Array.from({ length: 16 }, () => (
      resolveConversationWorkDirectory({
        conversationId: 'conv-single-port',
        directoryPort,
      })
    )));

    expect(results.every(result => result.status === 'created')).toBe(true);
    expect(new Set(results.map(result => result.absolutePath)).size).toBe(1);
    expect(await fsp.readdir(results[0].absolutePath)).toEqual([]);
  });

  it('纯路径解析不会创建目录，只有 ensure 编排可以产生磁盘副作用', async () => {
    const storageRoot = await createTestRoot('pure-resolve');
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const identity = deriveConversationWorkDirectoryIdentity('conv-no-side-effect');

    const absolutePath = directoryPort.resolvePath(identity);
    await expect(fsp.lstat(absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });

    await directoryPort.ensureDirectory(identity);
    await expect(fsp.lstat(absolutePath)).resolves.toMatchObject({});
  });

  it('拒绝占位文件、未知空目录、错误 sidecar 和损坏 sidecar，不覆盖未知内容', async () => {
    const storageRoot = await createTestRoot('unsafe');
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const occupiedIdentity = deriveConversationWorkDirectoryIdentity('conv-occupied');
    const occupiedPath = directoryPort.resolvePath(occupiedIdentity);
    await fsp.mkdir(path.dirname(occupiedPath), { recursive: true });
    await fsp.writeFile(occupiedPath, 'do-not-overwrite', 'utf8');

    await expect(directoryPort.ensureDirectory(occupiedIdentity)).rejects.toMatchObject({
      code: 'work_directory_path_occupied',
      stage: 'inspect_directory',
    });
    await expect(fsp.readFile(occupiedPath, 'utf8')).resolves.toBe('do-not-overwrite');

    const emptyDirectoryIdentity = deriveConversationWorkDirectoryIdentity('conv-empty-unknown');
    const emptyDirectoryPath = directoryPort.resolvePath(emptyDirectoryIdentity);
    await fsp.mkdir(emptyDirectoryPath);
    await expect(directoryPort.ensureDirectory(emptyDirectoryIdentity)).rejects.toMatchObject({
      code: 'work_directory_path_occupied',
      stage: 'inspect_directory',
    });
    expect(await fsp.readdir(emptyDirectoryPath)).toEqual([]);
    await expect(fsp.lstat(resolveOwnerMarkerPath(storageRoot, 'conv-empty-unknown')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const wrongIdentity = deriveConversationWorkDirectoryIdentity('conv-wrong-marker');
    const wrongMarkerPath = resolveOwnerMarkerPath(storageRoot, 'conv-wrong-marker');
    await fsp.mkdir(path.dirname(wrongMarkerPath), { recursive: true });
    await fsp.writeFile(
      wrongMarkerPath,
      JSON.stringify(createConversationWorkDirectoryOwnerMarker(
        deriveConversationWorkDirectoryIdentity('another-conversation'),
      )),
      'utf8',
    );
    await expect(directoryPort.ensureDirectory(wrongIdentity)).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });

    const brokenIdentity = deriveConversationWorkDirectoryIdentity('conv-broken-marker');
    const brokenMarkerPath = resolveOwnerMarkerPath(storageRoot, 'conv-broken-marker');
    await fsp.writeFile(
      brokenMarkerPath,
      '{broken-json',
      'utf8',
    );
    await expect(directoryPort.ensureDirectory(brokenIdentity)).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });
  });

  it.runIf(process.platform !== 'win32')(
    '拒绝把 conversation 目录符号链接当成受 Linnya 所有的真实目录',
    async () => {
      const storageRoot = await createTestRoot('symlink');
      const outsideRoot = await createTestRoot('outside');
      const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
      const identity = deriveConversationWorkDirectoryIdentity('conv-symlink');
      const directoryPath = directoryPort.resolvePath(identity);
      await fsp.mkdir(path.dirname(directoryPath), { recursive: true });
      await fsp.symlink(outsideRoot, directoryPath, 'dir');

      await expect(directoryPort.ensureDirectory(identity)).rejects.toMatchObject({
        code: 'work_directory_unsafe_entry',
        stage: 'inspect_directory',
      });
      expect(await fsp.readdir(outsideRoot)).toEqual([]);
    },
  );

  it('工作目录被清空或删除时，App-owned metadata 不受影响并可识别缺失重建', async () => {
    const storageRoot = await createTestRoot('missing-recovery');
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({
      conversationId: 'conv-recovery',
      directoryPort,
    });
    await fsp.writeFile(path.join(created.absolutePath, '.agent-hidden-file'), 'temporary', 'utf8');
    await fsp.rm(path.join(created.absolutePath, '.agent-hidden-file'));

    const stillReady = await resolveConversationWorkDirectory({
      conversationId: 'conv-recovery',
      directoryPort,
    });
    expect(stillReady.status).toBe('existing');
    expect(await fsp.readdir(stillReady.absolutePath)).toEqual([]);

    await fsp.rm(stillReady.absolutePath, { recursive: true });
    const recreated = await resolveConversationWorkDirectory({
      conversationId: 'conv-recovery',
      directoryPort: createLocalConversationDirectoryPort({ storageRoot }),
    });
    expect(recreated.status).toBe('recreated_missing');
    expect(await fsp.readdir(recreated.absolutePath)).toEqual([]);
  });

  it('精准清理幂等删除嵌套工作文件，但保留 metadata 供恢复投影旧文件已丢失', async () => {
    const storageRoot = await createTestRoot('delete-work-directory');
    const conversationId = 'conv-delete-work-directory';
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
    await fsp.mkdir(path.join(created.absolutePath, 'nested'));
    await fsp.writeFile(
      path.join(created.absolutePath, 'nested', 'evidence.txt'),
      'delete-me',
      'utf8',
    );

    await deleteConversationWorkDirectory({
      conversationId,
      deletionPort: directoryPort,
    });
    await expect(fsp.lstat(created.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.lstat(resolveOwnerMarkerPath(storageRoot, conversationId)))
      .resolves.toMatchObject({});
    await expect(fsp.lstat(resolveInitializedMarkerPath(storageRoot, conversationId)))
      .resolves.toMatchObject({});

    await deleteConversationWorkDirectory({
      conversationId,
      deletionPort: createLocalConversationDirectoryPort({ storageRoot }),
    });
    const restored = await resolveConversationWorkDirectory({
      conversationId,
      directoryPort: createLocalConversationDirectoryPort({ storageRoot }),
    });
    expect(restored.status).toBe('recreated_missing');
    expect(await fsp.readdir(restored.absolutePath)).toEqual([]);
  });

  it('只读计量嵌套文件且不递归静态链接，目录消失后只陈述文件不可用', async () => {
    const storageRoot = await createTestRoot('measure-work-directory');
    const outsideRoot = await createTestRoot('measure-work-directory-outside');
    const conversationId = 'conv-measure-work-directory';
    const identity = deriveConversationWorkDirectoryIdentity(conversationId);
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });

    await expect(directoryPort.measureWorkDirectory(identity)).resolves.toMatchObject({
      state: 'not_created',
      byteSize: 0,
      fileCount: 0,
    });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
    await fsp.mkdir(path.join(created.absolutePath, 'nested'));
    await fsp.writeFile(path.join(created.absolutePath, 'root.txt'), '1234', 'utf8');
    await fsp.writeFile(path.join(created.absolutePath, 'nested', 'child.txt'), 'abc', 'utf8');
    await fsp.writeFile(path.join(outsideRoot, 'outside.txt'), 'must-not-count', 'utf8');
    // Windows 普通用户通常不能创建目录符号链接，但可以创建 junction；两者都必须被当成
    // 管理边界而不是目录入口，避免测试只覆盖开发者模式开启的机器。
    await fsp.symlink(
      outsideRoot,
      path.join(created.absolutePath, 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const linkSize = (await fsp.lstat(path.join(created.absolutePath, 'outside-link'))).size;
    await expect(directoryPort.measureWorkDirectory(identity)).resolves.toMatchObject({
      state: 'available',
      byteSize: 7 + linkSize,
      fileCount: 3,
    });

    await directoryPort.deleteWorkDirectory(identity);
    await expect(directoryPort.measureWorkDirectory(identity)).resolves.toMatchObject({
      state: 'previous_files_unavailable',
      byteSize: 0,
      fileCount: 0,
    });
    await expect(fsp.readFile(path.join(outsideRoot, 'outside.txt'), 'utf8'))
      .resolves.toBe('must-not-count');
  });

  it('完整删除只能在工作目录消失后移除 metadata，且重复执行保持幂等', async () => {
    const storageRoot = await createTestRoot('delete-identity-metadata');
    const conversationId = 'conv-delete-identity-metadata';
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });

    await expect(deleteConversationDirectoryIdentityMetadata({
      conversationId,
      deletionPort: directoryPort,
    })).rejects.toMatchObject({
      code: 'work_directory_still_present',
      stage: 'delete_identity_metadata',
    });
    await expect(fsp.lstat(created.absolutePath)).resolves.toMatchObject({});

    await deleteConversationWorkDirectory({ conversationId, deletionPort: directoryPort });
    await deleteConversationDirectoryIdentityMetadata({
      conversationId,
      deletionPort: directoryPort,
    });
    await expect(fsp.lstat(resolveOwnerMarkerPath(storageRoot, conversationId)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.lstat(resolveInitializedMarkerPath(storageRoot, conversationId)))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const restartedPort = createLocalConversationDirectoryPort({ storageRoot });
    await deleteConversationWorkDirectory({ conversationId, deletionPort: restartedPort });
    await deleteConversationDirectoryIdentityMetadata({
      conversationId,
      deletionPort: restartedPort,
    });
    const newLifecycle = await resolveConversationWorkDirectory({
      conversationId,
      directoryPort: restartedPort,
    });
    expect(newLifecycle.status).toBe('created');
  });

  it('owner 缺失或错配时拒绝递归删除，并保留原工作文件', async () => {
    const storageRoot = await createTestRoot('delete-owner-mismatch');
    const conversationId = 'conv-delete-owner-mismatch';
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
    const evidencePath = path.join(created.absolutePath, 'must-stay.txt');
    await fsp.writeFile(evidencePath, 'preserved', 'utf8');
    await fsp.rm(resolveOwnerMarkerPath(storageRoot, conversationId));

    await expect(deleteConversationWorkDirectory({
      conversationId,
      deletionPort: directoryPort,
    })).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });
    await expect(fsp.readFile(evidencePath, 'utf8')).resolves.toBe('preserved');

    await fsp.writeFile(
      resolveOwnerMarkerPath(storageRoot, conversationId),
      JSON.stringify(createConversationWorkDirectoryOwnerMarker(
        deriveConversationWorkDirectoryIdentity('different-conversation'),
      )),
      'utf8',
    );
    await expect(deleteConversationWorkDirectory({
      conversationId,
      deletionPort: directoryPort,
    })).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });
    await expect(fsp.readFile(evidencePath, 'utf8')).resolves.toBe('preserved');
  });

  it('工作目录已缺失时仍拒绝损坏或失去 owner 的 metadata，不把坏状态伪装成清理成功', async () => {
    const storageRoot = await createTestRoot('delete-invalid-metadata');
    const conversationId = 'conv-delete-invalid-metadata';
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
    const ownerMarkerPath = resolveOwnerMarkerPath(storageRoot, conversationId);
    const initializedMarkerPath = resolveInitializedMarkerPath(storageRoot, conversationId);
    await fsp.rm(created.absolutePath, { recursive: true });
    await fsp.rm(ownerMarkerPath);

    await expect(deleteConversationWorkDirectory({
      conversationId,
      deletionPort: directoryPort,
    })).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });
    await expect(deleteConversationDirectoryIdentityMetadata({
      conversationId,
      deletionPort: directoryPort,
    })).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });
    await expect(fsp.lstat(initializedMarkerPath)).resolves.toMatchObject({});

    await fsp.writeFile(ownerMarkerPath, '{broken-json', 'utf8');
    await expect(deleteConversationWorkDirectory({
      conversationId,
      deletionPort: directoryPort,
    })).rejects.toMatchObject({
      code: 'work_directory_unsafe_entry',
      stage: 'read_identity_marker',
    });
    await expect(fsp.readFile(ownerMarkerPath, 'utf8')).resolves.toBe('{broken-json');
  });

  it('metadata 删除在 initialized 已删而 owner 尚在的中断点可以安全续跑', async () => {
    const storageRoot = await createTestRoot('delete-metadata-resume');
    const conversationId = 'conv-delete-metadata-resume';
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
    const ownerMarkerPath = resolveOwnerMarkerPath(storageRoot, conversationId);
    const initializedMarkerPath = resolveInitializedMarkerPath(storageRoot, conversationId);
    await fsp.rm(created.absolutePath, { recursive: true });
    await fsp.rm(initializedMarkerPath);

    await deleteConversationDirectoryIdentityMetadata({
      conversationId,
      deletionPort: createLocalConversationDirectoryPort({ storageRoot }),
    });

    await expect(fsp.lstat(ownerMarkerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.lstat(initializedMarkerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('递归清理只删除工作目录内部链接，不跟随链接删除外部文件', async () => {
    const storageRoot = await createTestRoot('delete-child-link');
    const outsideRoot = await createTestRoot('delete-child-link-outside');
    const conversationId = 'conv-delete-child-link';
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
    const outsideEvidencePath = path.join(outsideRoot, 'must-stay.txt');
    await fsp.writeFile(outsideEvidencePath, 'outside', 'utf8');
    await fsp.symlink(
      outsideRoot,
      path.join(created.absolutePath, 'external-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await deleteConversationWorkDirectory({ conversationId, deletionPort: directoryPort });

    await expect(fsp.lstat(created.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.readFile(outsideEvidencePath, 'utf8')).resolves.toBe('outside');
  });

  it.runIf(process.platform !== 'win32')(
    '删除拒绝工作目录符号链接，不触碰链接外的真实目录',
    async () => {
      const storageRoot = await createTestRoot('delete-symlink');
      const outsideRoot = await createTestRoot('delete-symlink-outside');
      const conversationId = 'conv-delete-symlink';
      const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
      const created = await resolveConversationWorkDirectory({ conversationId, directoryPort });
      await fsp.rm(created.absolutePath, { recursive: true });
      await fsp.writeFile(path.join(outsideRoot, 'outside.txt'), 'outside', 'utf8');
      await fsp.symlink(outsideRoot, created.absolutePath, 'dir');

      await expect(deleteConversationWorkDirectory({
        conversationId,
        deletionPort: directoryPort,
      })).rejects.toMatchObject({
        code: 'work_directory_unsafe_entry',
        stage: 'inspect_directory',
      });
      await expect(fsp.readFile(path.join(outsideRoot, 'outside.txt'), 'utf8'))
        .resolves.toBe('outside');
    },
  );

  it('把无效 identity、相对根和不可用根转换成稳定错误', async () => {
    const storageRoot = await createTestRoot('errors');
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });

    for (const conversationId of ['', '  ', 'conv\0bad']) {
      await expect(resolveConversationWorkDirectory({ conversationId, directoryPort }))
        .rejects.toMatchObject({
          code: 'invalid_conversation_identity',
          stage: 'derive_identity',
        });
    }

    expect(() => createLocalConversationDirectoryPort({ storageRoot: 'relative/path' }))
      .toThrowError(ConversationDirectoryError);

    const fileRoot = path.join(storageRoot, 'not-a-directory');
    await fsp.writeFile(fileRoot, 'occupied', 'utf8');
    const invalidRootPort = createLocalConversationDirectoryPort({ storageRoot: fileRoot });
    await expect(resolveConversationWorkDirectory({
      conversationId: 'conv-root-file',
      directoryPort: invalidRootPort,
    })).rejects.toMatchObject({
      code: 'work_directory_root_unavailable',
      stage: 'prepare_namespace',
    });
  });

  it('目录布局固定在注入根的版本命名空间内', async () => {
    const storageRoot = await createTestRoot('layout');
    const directoryPort = createLocalConversationDirectoryPort({ storageRoot });
    const resolution = await resolveConversationWorkDirectory({
      conversationId: 'conv-layout',
      directoryPort,
    });

    expect(path.relative(storageRoot, resolution.absolutePath).split(path.sep).slice(0, 3))
      .toEqual([
        CONVERSATION_WORK_DIRECTORY_NAMESPACE,
        'v1',
        CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY,
      ]);
    expect(path.relative(storageRoot, resolution.absolutePath)).not.toMatch(/^\.\./);
  });
});
