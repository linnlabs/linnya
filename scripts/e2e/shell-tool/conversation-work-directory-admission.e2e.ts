import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryCleanupFailure,
  type ConversationDirectoryCleanupJob,
  type ConversationDirectoryCleanupJobBeginResult,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryCleanupJobScope,
} from '../../../src/domains/conversation-files';
import { createLocalConversationDirectoryPort } from '../../../src/infra/adapters/conversation-files/local-directory';
import {
  createConversationLifecycleApplicationScope,
} from '../../../src/app-hosts/linnya/application/conversation-lifecycle';

class MemoryCleanupJobPort implements ConversationDirectoryCleanupJobPort {
  private current: ConversationDirectoryCleanupJob | null = null;

  async begin(
    job: ConversationDirectoryCleanupJob,
  ): Promise<ConversationDirectoryCleanupJobBeginResult> {
    if (this.current) {
      return { status: 'existing', job: this.current };
    }
    this.current = job;
    return { status: 'created', job };
  }

  async read(): Promise<ConversationDirectoryCleanupJob | null> {
    return this.current;
  }

  async list(): Promise<readonly ConversationDirectoryCleanupJob[]> {
    return this.current ? [this.current] : [];
  }

  async recordFailure(
    _input: ConversationDirectoryCleanupJobScope & {
      readonly failure: ConversationDirectoryCleanupFailure;
    },
  ): Promise<ConversationDirectoryCleanupJob | null> {
    return this.current;
  }

  async complete(): Promise<boolean> {
    this.current = null;
    return true;
  }
}

function createBlocker(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function main(): Promise<void> {
  const runRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'linnya-work-directory-admission-e2e-中文 path-'),
  );

  try {
  const cleanupJobs = new MemoryCleanupJobPort();
  const directories = createLocalConversationDirectoryPort({ storageRoot: runRoot });
  const scope = createConversationLifecycleApplicationScope({
    cleanupJobs,
    directories,
    facts: {
      exists: async () => false,
      ensure: async () => {},
    },
  });
  const identity = deriveConversationWorkDirectoryIdentity('admission-e2e-conversation');
  const admissionEntered = createBlocker();
  const releaseAdmission = createBlocker();

  const admission = scope.workDirectoryAdmission.withAdmission({
    conversationId: identity.conversationId,
  }, async directory => {
    assert.equal(directory.status, 'created');
    admissionEntered.release();
    await releaseAdmission.promise;
    return directory;
  });
  await admissionEntered.promise;

  const cleanup = scope.gate.runExclusive({
    scope: {
      conversationId: identity.conversationId,
      operation: 'directory_cleanup_job',
    },
    run: () => cleanupJobs.begin(createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_40000000-0000-4000-8000-000000000001',
      identity,
      operation: 'delete_conversation',
      requestedAt: 1_785_499_200_000,
    })),
  });

  await Promise.resolve();
  assert.equal(await cleanupJobs.read(identity.conversationId), null);
  releaseAdmission.release();
  const admittedDirectory = await admission;
  assert.equal((await fsp.stat(admittedDirectory.absolutePath)).isDirectory(), true);
  assert.equal((await cleanup).status, 'created');

  let blockedCallbackCalled = false;
  await assert.rejects(scope.workDirectoryAdmission.withAdmission({
    conversationId: identity.conversationId,
  }, () => {
    blockedCallbackCalled = true;
  }), (error: unknown) => (
    error instanceof Error
    && 'code' in error
    && error.code === 'work_directory_cleanup_in_progress'
  ));
  assert.equal(blockedCallbackCalled, false);

  await cleanupJobs.complete({
    jobId: 'conversation_cleanup_40000000-0000-4000-8000-000000000001',
    conversationId: identity.conversationId,
    operation: 'delete_conversation',
  });
  const callbackFailure = new Error('owner reservation failed');
  await assert.rejects(scope.workDirectoryAdmission.withAdmission({
    conversationId: identity.conversationId,
  }, () => {
    throw callbackFailure;
  }), callbackFailure);
  const retried = await scope.workDirectoryAdmission.withAdmission({
    conversationId: identity.conversationId,
  }, directory => directory);
  assert.equal(retried.status, 'existing');

    process.stdout.write(`${JSON.stringify({
      ok: true,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      cases: 3,
    })}\n`);
  } finally {
    await fsp.rm(runRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
