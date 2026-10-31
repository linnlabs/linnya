import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CommandAgentRunIdSchema, type CommandApprovalChoice, type CommandPermissionLevel } from '@app/schemas/commands';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCommandRunPermissionSnapshot,
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  type ConversationCommandApproval,
} from 'src/domains/commands';
import {
  ConversationWorkDirectoryConversationIdSchema,
  ConversationWorkDirectoryDigestSchema,
  ConversationWorkDirectoryKeySchema,
} from 'src/domains/conversation-files';
import { createNodePhysicalFileReader } from '../file-read/createNodePhysicalFileReader';
import { createInternalStorageFileAccessPort } from './createInternalStorageFileAccessPort';
import { createNodeInternalStoragePathPolicy } from './createNodeInternalStoragePathPolicy';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-internal-file-access-'));
  roots.push(root);
  const appData = path.join(root, 'app-data');
  const current = path.join(appData, 'conversations', 'current');
  const other = path.join(appData, 'conversations', 'other');
  const cli = path.join(appData, 'cli');
  await Promise.all([current, other, cli].map(dir => fsp.mkdir(dir, { recursive: true })));
  const credential = path.join(appData, 'credentials.json');
  const ordinary = path.join(root, 'ordinary.txt');
  const currentFile = path.join(current, 'input.txt');
  const otherFile = path.join(other, 'input.txt');
  await Promise.all([credential, ordinary, currentFile, otherFile].map(file => fsp.writeFile(file, 'fixture-only')));
  const policy = createNodeInternalStoragePathPolicy({ protected_roots: [appData], readable_roots: [cli] });
  const remembered: ConversationCommandApproval[] = [];
  let choice: CommandApprovalChoice = 'deny';
  let prompts = 0;
  let failPersistence = false;
  let admissionHeld = false;
  const access = createInternalStorageFileAccessPort({
    policy,
    platform: process.platform === 'win32' ? 'windows' : 'macos',
    readOwnerGenerationId: () => 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
    conversationAdmission: {
      async withAdmission(input, admitted) {
        admissionHeld = true;
        try {
          return await admitted({
            identity: {
              kind: 'linnya_conversation_work_directory', revision: 1,
              conversationId: ConversationWorkDirectoryConversationIdSchema.parse(input.conversationId),
              conversationIdDigest: ConversationWorkDirectoryDigestSchema.parse('a'.repeat(64)),
              directoryKey: ConversationWorkDirectoryKeySchema.parse(`conversation_${'a'.repeat(64)}`),
            },
            absolutePath: current, status: 'existing',
          });
        } finally { admissionHeld = false; }
      },
    },
    approvals: {
      async listForConversation() { return remembered; },
      async remember(approval) {
        if (failPersistence) throw new Error('injected persistence failure');
        remembered.push(approval);
        return { status: 'created', approval };
      },
      async revoke(id) {
        const index = remembered.findIndex(item => item.approvalRequestId === id);
        if (index >= 0) remembered.splice(index, 1);
      },
    },
    approval: {
      async request({ request }) {
        // 用户等待期间不能锁住对话删除准入。
        expect(admissionHeld).toBe(false);
        expect(request.reasons).toEqual([{ type: 'internal_storage_access' }]);
        prompts++;
        return {
          status: 'replied',
          reply: {
            protocol_version: 1, kind: 'command_approval_reply',
            approval_request_id: request.approval_request_id, choice,
          },
        };
      },
      async settle() {},
    },
  });
  return {
    root, appData, current, cli, credential, ordinary, currentFile, otherFile, policy, remembered,
    get prompts() { return prompts; },
    setChoice(value: CommandApprovalChoice) { choice = value; },
    failPersistence() { failPersistence = true; },
    read(absolutePath: string, level: CommandPermissionLevel = 'standard', conversationId = 'storage-conversation') {
      return createNodePhysicalFileReader().readFile({
        absolutePath, scope: { kind: 'host' },
        authorizeRead: resolvedPath => access.authorizeRead({
          absolutePath: resolvedPath, conversationId,
          agentRunId: 'storage-run', toolCallId: 'storage-tool-call',
          permission: {
            status: 'available',
            snapshot: createCommandRunPermissionSnapshot({
              settings: { ...DEFAULT_COMMAND_PERMISSION_SETTINGS, permission_level: level },
              rootAgentRunId: CommandAgentRunIdSchema.parse('storage-run'), capturedAtMs: 1,
            }),
          },
        }),
      });
    },
  };
}

describe('内部文件读取：真实路径、审批、持久规则与读取正文', () => {
  it.each(['read_only', 'standard'] as const)('%s：默认阻止内部文件，仅允许本次后再次审批', async level => {
    const f = await fixture();
    await expect(f.read(f.credential, level)).rejects.toMatchObject({ code: 'READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED' });
    f.setChoice('allow_once');
    await expect(f.read(f.credential, level)).resolves.toMatchObject({ text: 'fixture-only' });
    f.setChoice('deny');
    await expect(f.read(f.credential, level)).rejects.toMatchObject({ code: 'READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED' });
    expect(f.remembered).toHaveLength(0);
    expect(f.prompts).toBe(3);
    await expect(f.read(f.ordinary, level)).resolves.toMatchObject({ text: 'fixture-only' });
    await expect(f.read(f.currentFile, level)).resolves.toMatchObject({ text: 'fixture-only' });
    expect(f.prompts).toBe(3);
  });

  it('保存规则只复用同一对话的同一文件，保存失败不能降为允许本次', async () => {
    const f = await fixture();
    f.setChoice('allow_for_conversation');
    await f.read(f.credential);
    f.setChoice('deny');
    await f.read(f.credential);
    expect(f.prompts).toBe(1);
    await expect(f.read(f.otherFile)).rejects.toMatchObject({ code: 'READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED' });
    await expect(f.read(f.credential, 'standard', 'another-conversation')).rejects.toMatchObject({ code: 'READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED' });
    f.setChoice('allow_for_conversation');
    f.failPersistence();
    await expect(f.read(f.otherFile)).rejects.toMatchObject({ code: 'READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED' });
    expect(f.remembered).toHaveLength(1);
  });

  it('完全访问无需审批；缺失凭据文件仍被路径策略识别', async () => {
    const f = await fixture();
    await expect(f.read(f.credential, 'full_access')).resolves.toMatchObject({ text: 'fixture-only' });
    expect(f.prompts).toBe(0);
    expect(await f.policy.isProtectedPath(path.join(f.appData, 'config', 'credentials.json'), f.current)).toBe(true);
    expect(await f.policy.isProtectedPath(path.join(f.cli, 'client'), f.current)).toBe(false);
    expect(await f.policy.commandRequestsAccess({
      command: `cat '${f.credential}'`, cwd: f.current, conversationRoot: f.current,
      context: { platform: 'macos', shellSemanticsId: 'zsh' },
    })).toBe(true);
    expect(await f.policy.commandRequestsAccess({
      command: 'cat input.txt', cwd: f.current, conversationRoot: f.current,
      context: { platform: 'macos', shellSemanticsId: 'zsh' },
    })).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('会话内 symlink 不能绕过 host 文件读取审批', async () => {
    const f = await fixture();
    const alias = path.join(f.current, 'alias');
    await fsp.symlink(f.credential, alias);
    await expect(f.read(alias)).rejects.toMatchObject({ code: 'READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED' });
    f.setChoice('allow_for_conversation');
    await f.read(alias);
    f.setChoice('deny');
    await f.read(f.credential);
    expect(f.prompts).toBe(2);
  });
});
