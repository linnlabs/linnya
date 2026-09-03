import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  deleteConversationDirectoryIdentityMetadata,
  deleteConversationWorkDirectory,
  deriveConversationWorkDirectoryIdentity,
  resolveConversationWorkDirectory,
} from '../../../src/domains/conversation-files';
import { createLocalConversationDirectoryPort } from '../../../src/infra/adapters/conversation-files/local-directory';

const runRoot = await fsp.mkdtemp(
  path.join(os.tmpdir(), 'linnya-conversation-directory-e2e-中文 path-'),
);
let succeeded = false;

async function waitForStdoutLine(input: {
  readonly child: ReturnType<typeof spawn>;
  readonly expected: string;
  readonly timeoutMs: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for child output: ${input.expected}`));
    }, input.timeoutMs);
    input.child.stdout?.setEncoding('utf8');
    input.child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(input.expected)) {
        clearTimeout(timer);
        resolve();
      }
    });
    input.child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    input.child.once('exit', (code) => {
      if (!stdout.includes(input.expected)) {
        clearTimeout(timer);
        reject(new Error(`Child exited before lock confirmation: ${String(code)}`));
      }
    });
  });
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
}

function resolveMarkerPath(
  conversationId: string,
  suffix: string,
): string {
  const identity = deriveConversationWorkDirectoryIdentity(conversationId);
  return path.join(
    runRoot,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
    `${identity.directoryKey}${suffix}`,
  );
}

try {
  const firstPort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const first = await resolveConversationWorkDirectory({
    conversationId: 'e2e/conversation',
    directoryPort: firstPort,
  });
  const collidingUnderSanitizer = await resolveConversationWorkDirectory({
    conversationId: 'e2e?conversation',
    directoryPort: firstPort,
  });
  assert.equal(first.status, 'created');
  assert.equal(collidingUnderSanitizer.status, 'created');
  assert.notEqual(first.absolutePath, collidingUnderSanitizer.absolutePath);
  assert.deepEqual(await fsp.readdir(first.absolutePath), []);

  const evidencePath = path.join(first.absolutePath, 'external-evidence.txt');
  await fsp.writeFile(evidencePath, `${process.platform}\n`, 'utf8');

  const restored = await resolveConversationWorkDirectory({
    conversationId: 'e2e/conversation',
    directoryPort: createLocalConversationDirectoryPort({ storageRoot: runRoot }),
  });
  assert.equal(restored.status, 'existing');
  assert.equal(restored.absolutePath, first.absolutePath);
  assert.equal(await fsp.readFile(evidencePath, 'utf8'), `${process.platform}\n`);

  const concurrentIdentity = deriveConversationWorkDirectoryIdentity('e2e-concurrent');
  const concurrent = await Promise.all(Array.from({ length: 16 }, () => (
    createLocalConversationDirectoryPort({ storageRoot: runRoot })
      .ensureDirectory(concurrentIdentity)
  )));
  assert(concurrent.some(result => result.status === 'created'));
  assert.equal(new Set(concurrent.map(result => result.absolutePath)).size, 1);

  await fsp.rm(concurrent[0].absolutePath, { recursive: true });
  const recreated = await createLocalConversationDirectoryPort({ storageRoot: runRoot })
    .ensureDirectory(concurrentIdentity);
  assert.equal(recreated.status, 'recreated_missing');
  assert.deepEqual(await fsp.readdir(recreated.absolutePath), []);

  const deletionConversationId = 'e2e-delete-conversation';
  const deletionPort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const deletionDirectory = await resolveConversationWorkDirectory({
    conversationId: deletionConversationId,
    directoryPort: deletionPort,
  });
  await fsp.mkdir(path.join(deletionDirectory.absolutePath, 'nested'));
  await fsp.writeFile(
    path.join(deletionDirectory.absolutePath, 'nested', 'delete.txt'),
    'delete',
    'utf8',
  );
  await fsp.writeFile(
    path.join(deletionDirectory.absolutePath, '.binary-evidence'),
    Buffer.from([0x00, 0xff, 0x41, 0x0a]),
  );
  const readOnlyPath = path.join(deletionDirectory.absolutePath, 'read-only.txt');
  await fsp.writeFile(readOnlyPath, 'read-only', 'utf8');
  await fsp.chmod(readOnlyPath, 0o444);
  await deleteConversationWorkDirectory({
    conversationId: deletionConversationId,
    deletionPort,
  });
  await assert.rejects(fsp.lstat(deletionDirectory.absolutePath), { code: 'ENOENT' });
  await fsp.lstat(resolveMarkerPath(
    deletionConversationId,
    CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  ));
  const restoredAfterClear = await resolveConversationWorkDirectory({
    conversationId: deletionConversationId,
    directoryPort: createLocalConversationDirectoryPort({ storageRoot: runRoot }),
  });
  assert.equal(restoredAfterClear.status, 'recreated_missing');

  await deleteConversationWorkDirectory({
    conversationId: deletionConversationId,
    deletionPort,
  });
  await deleteConversationDirectoryIdentityMetadata({
    conversationId: deletionConversationId,
    deletionPort,
  });
  await assert.rejects(
    fsp.lstat(resolveMarkerPath(
      deletionConversationId,
      CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
    )),
    { code: 'ENOENT' },
  );
  await assert.rejects(
    fsp.lstat(resolveMarkerPath(
      deletionConversationId,
      CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
    )),
    { code: 'ENOENT' },
  );

  const resumedMetadataConversationId = 'e2e-resumed-metadata-delete';
  const resumedMetadataPort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const resumedMetadataDirectory = await resolveConversationWorkDirectory({
    conversationId: resumedMetadataConversationId,
    directoryPort: resumedMetadataPort,
  });
  const resumedOwnerMarker = resolveMarkerPath(
    resumedMetadataConversationId,
    CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  );
  const resumedInitializedMarker = resolveMarkerPath(
    resumedMetadataConversationId,
    CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  );
  await fsp.rm(resumedMetadataDirectory.absolutePath, { recursive: true });
  // 模拟 metadata 删除到一半时 App 崩溃：owner 必须最后删除，才能在重启后继续验证归属。
  await fsp.rm(resumedInitializedMarker);
  await deleteConversationDirectoryIdentityMetadata({
    conversationId: resumedMetadataConversationId,
    deletionPort: createLocalConversationDirectoryPort({ storageRoot: runRoot }),
  });
  await assert.rejects(fsp.lstat(resumedOwnerMarker), { code: 'ENOENT' });

  const childLinkedConversationId = 'e2e-child-linked-delete-target';
  const childLinkedPort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const childLinkedDirectory = await resolveConversationWorkDirectory({
    conversationId: childLinkedConversationId,
    directoryPort: childLinkedPort,
  });
  const childLinkedOutsideDirectory = path.join(runRoot, 'outside-child-link-target');
  await fsp.mkdir(childLinkedOutsideDirectory);
  await fsp.writeFile(
    path.join(childLinkedOutsideDirectory, 'outside.txt'),
    'outside-child',
    'utf8',
  );
  await fsp.symlink(
    childLinkedOutsideDirectory,
    path.join(childLinkedDirectory.absolutePath, 'external-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await deleteConversationWorkDirectory({
    conversationId: childLinkedConversationId,
    deletionPort: childLinkedPort,
  });
  assert.equal(
    await fsp.readFile(path.join(childLinkedOutsideDirectory, 'outside.txt'), 'utf8'),
    'outside-child',
  );

  if (process.platform === 'win32') {
    const lockedConversationId = 'e2e-locked-file-delete';
    const lockedPort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
    const lockedDirectory = await resolveConversationWorkDirectory({
      conversationId: lockedConversationId,
      directoryPort: lockedPort,
    });
    const lockedFilePath = path.join(lockedDirectory.absolutePath, 'locked.txt');
    await fsp.writeFile(lockedFilePath, 'locked', 'utf8');
    const escapedLockedFilePath = lockedFilePath.replaceAll("'", "''");
    const lockScript = [
      `$stream = [System.IO.File]::Open('${escapedLockedFilePath}',`,
      '[System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite,',
      '[System.IO.FileShare]::None);',
      "[Console]::Out.WriteLine('LOCKED');",
      '[Console]::Out.Flush();',
      '[Console]::In.ReadLine() | Out-Null;',
      '$stream.Dispose();',
    ].join(' ');
    const lockOwner = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(lockScript, 'utf16le').toString('base64'),
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    try {
      await waitForStdoutLine({ child: lockOwner, expected: 'LOCKED', timeoutMs: 5_000 });
      const deleteStartedAt = Date.now();
      await assert.rejects(
        deleteConversationWorkDirectory({
          conversationId: lockedConversationId,
          deletionPort: lockedPort,
        }),
        (error: unknown) => (
          error instanceof Error
          && 'code' in error
          && error.code === 'work_directory_io_failed'
          && 'stage' in error
          && error.stage === 'delete_work_directory'
        ),
      );
      const deleteDurationMs = Date.now() - deleteStartedAt;
      assert(
        deleteDurationMs >= 500 && deleteDurationMs < 5_000,
        `Windows locked-file retry budget was ${deleteDurationMs} ms`,
      );
    } finally {
      lockOwner.stdin?.end('\n');
      await waitForExit(lockOwner);
    }

    await deleteConversationWorkDirectory({
      conversationId: lockedConversationId,
      deletionPort: createLocalConversationDirectoryPort({ storageRoot: runRoot }),
    });
    await assert.rejects(fsp.lstat(lockedDirectory.absolutePath), { code: 'ENOENT' });
  }

  const linkedNamespaceRoot = path.join(runRoot, 'linked-namespace-root');
  const linkedNamespaceOutside = path.join(runRoot, 'outside-namespace-target');
  await fsp.mkdir(linkedNamespaceRoot);
  await fsp.mkdir(linkedNamespaceOutside);
  await fsp.writeFile(
    path.join(linkedNamespaceOutside, 'must-stay.txt'),
    'outside-namespace',
    'utf8',
  );
  await fsp.symlink(
    linkedNamespaceOutside,
    path.join(linkedNamespaceRoot, CONVERSATION_WORK_DIRECTORY_NAMESPACE),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    deleteConversationWorkDirectory({
      conversationId: 'e2e-linked-namespace',
      deletionPort: createLocalConversationDirectoryPort({ storageRoot: linkedNamespaceRoot }),
    }),
    (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && error.code === 'work_directory_unsafe_entry'
      && 'stage' in error
      && error.stage === 'inspect_deletion_root'
    ),
  );
  assert.equal(
    await fsp.readFile(path.join(linkedNamespaceOutside, 'must-stay.txt'), 'utf8'),
    'outside-namespace',
  );

  const linkedConversationId = 'e2e-linked-delete-target';
  const linkedPort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const linkedDirectory = await resolveConversationWorkDirectory({
    conversationId: linkedConversationId,
    directoryPort: linkedPort,
  });
  const outsideDirectory = path.join(runRoot, 'outside-delete-target');
  await fsp.mkdir(outsideDirectory);
  await fsp.writeFile(path.join(outsideDirectory, 'outside.txt'), 'outside', 'utf8');
  await fsp.rm(linkedDirectory.absolutePath, { recursive: true });
  await fsp.symlink(
    outsideDirectory,
    linkedDirectory.absolutePath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    deleteConversationWorkDirectory({
      conversationId: linkedConversationId,
      deletionPort: linkedPort,
    }),
    (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && error.code === 'work_directory_unsafe_entry'
    ),
  );
  assert.equal(
    await fsp.readFile(path.join(outsideDirectory, 'outside.txt'), 'utf8'),
    'outside',
  );

  const unsafeIdentity = deriveConversationWorkDirectoryIdentity('e2e-unsafe');
  const unsafePort = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const unsafeMarkerPath = path.join(
    runRoot,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
    `${unsafeIdentity.directoryKey}${CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX}`,
  );
  await fsp.writeFile(
    unsafeMarkerPath,
    '{invalid',
    'utf8',
  );
  await assert.rejects(
    unsafePort.ensureDirectory(unsafeIdentity),
    (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && error.code === 'work_directory_unsafe_entry'
    ),
  );

  succeeded = true;
  console.log(
    `[shell-tool-conversation-directory] ${process.platform} 稳定身份、恢复、幂等删除、metadata 中断恢复、链接边界和并发发布合同通过。`,
  );
} finally {
  if (succeeded) {
    await fsp.rm(runRoot, { recursive: true, force: true });
  } else {
    console.error(`[shell-tool-conversation-directory] 失败现场保留在 ${runRoot}`);
  }
}
