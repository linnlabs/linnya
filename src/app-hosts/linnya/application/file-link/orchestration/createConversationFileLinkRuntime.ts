import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import {
  ConversationFileLinkResolutionSchema,
  parseFileLocator,
  type ConversationFileLinkResolution,
  type ConversationFileLinkResolveRequest,
  type ConversationFileLinkRevealRequest,
  type ParsedFileLocator,
} from '@app/schemas';
import { inspectNodePhysicalRegularFile } from 'src/app-hosts/linnya/adapters/file-read/resolveNodePhysicalFileSource';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from 'src/app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import { PhysicalFileReadError } from 'src/app-hosts/linnya/application/file-read';
import { resolveWorkspaceVfsNode } from 'src/features/workspace/vfs/orchestration/resolveWorkspaceVfsNode';
import type { ConversationFileLinkRuntimePort } from '../definitions/conversationFileLinkRuntimePort';

interface ConversationProjectRow {
  readonly project_id: string | null;
}

function projectPhysicalIssue(
  locator: ConversationFileLinkResolveRequest['locator'],
  error: unknown,
): ConversationFileLinkResolution {
  if (!(error instanceof PhysicalFileReadError)) throw error;
  if (error.code === 'READ_FILE_NOT_FOUND') {
    return { state: 'missing', locator, issue_code: 'target_missing' };
  }
  if (error.code === 'READ_FILE_OS_ACCESS_DENIED') {
    return { state: 'unavailable', locator, issue_code: 'os_access_denied' };
  }
  if (error.code === 'READ_FILE_NOT_REGULAR_FILE' || error.code === 'READ_FILE_LOCATOR_INVALID') {
    return { state: 'unavailable', locator, issue_code: 'target_not_regular_file' };
  }
  throw error;
}

function hostAbsolutePath(parsed: Extract<ParsedFileLocator, { kind: 'file' }>): string {
  const absolutePath = fileURLToPath(parsed.url);
  if (absolutePath.includes('\0')) {
    throw new PhysicalFileReadError('READ_FILE_LOCATOR_INVALID', 'file locator 解码后包含 NUL。');
  }
  return absolutePath;
}

async function withPhysicalTarget<T>(input: {
  readonly parsed: Extract<ParsedFileLocator, { kind: 'conversation' | 'file' }>;
  readonly conversationId: string;
  readonly admission: ConversationWorkDirectoryAdmissionPort;
  readonly use: (target: {
    readonly absolutePath: string;
    readonly scope: { readonly kind: 'host' } | { readonly kind: 'conversation'; readonly rootPath: string };
  }) => Promise<T>;
}): Promise<T> {
  if (input.parsed.kind === 'file') {
    return input.use({
      absolutePath: hostAbsolutePath(input.parsed),
      scope: { kind: 'host' },
    });
  }
  const conversationParsed = input.parsed;
  return input.admission.withAdmission(
    { conversationId: input.conversationId },
    directory => input.use({
      absolutePath: path.resolve(directory.absolutePath, ...conversationParsed.relativePath.split('/')),
      scope: { kind: 'conversation', rootPath: directory.absolutePath },
    }),
  );
}

export function createConversationFileLinkRuntime(input: {
  readonly db: Database.Database;
  readonly conversationWorkDirectoryAdmission: ConversationWorkDirectoryAdmissionPort;
}): ConversationFileLinkRuntimePort {
  const readConversationProject = input.db.prepare<[string], ConversationProjectRow>(`
    SELECT project_id
    FROM conversations
    WHERE conversation_id = ?
    LIMIT 1
  `);

  async function resolveWorkspace(
    request: ConversationFileLinkResolveRequest,
    parsed: Extract<ParsedFileLocator, { kind: 'workspace' }>,
  ): Promise<ConversationFileLinkResolution> {
    const projectId = readConversationProject.get(request.conversation_id)?.project_id?.trim();
    if (!projectId) {
      return {
        state: 'unavailable',
        locator: parsed.locator,
        issue_code: 'conversation_project_missing',
      };
    }
    const resolved = await resolveWorkspaceVfsNode({
      db: input.db,
      projectId,
      conversationId: request.conversation_id,
      instanceId: 'default',
      includeSystemNodes: true,
      nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
      path: parsed.path,
    });
    if (!resolved.ok) {
      return { state: 'missing', locator: parsed.locator, issue_code: 'target_missing' };
    }
    if (resolved.node.type === 'folder' || resolved.node.type === 'system_file') {
      return {
        state: 'unavailable',
        locator: parsed.locator,
        issue_code: 'workspace_target_not_openable',
      };
    }
    return {
      state: 'ready',
      kind: 'workspace',
      locator: parsed.locator,
      project_id: projectId,
      document_id: resolved.node.id,
      node_type: resolved.node.type,
      title: resolved.node.display_name?.trim() || resolved.node.name,
      parent_id: resolved.node.parent_id,
    };
  }

  async function resolvePhysical(
    request: ConversationFileLinkResolveRequest,
    parsed: Extract<ParsedFileLocator, { kind: 'conversation' | 'file' }>,
  ): Promise<ConversationFileLinkResolution> {
    try {
      const inspected = await withPhysicalTarget({
        parsed,
        conversationId: request.conversation_id,
        admission: input.conversationWorkDirectoryAdmission,
        use: inspectNodePhysicalRegularFile,
      });
      return {
        state: 'ready',
        kind: parsed.kind,
        locator: parsed.locator,
        file_name: inspected.fileName,
      };
    } catch (error: unknown) {
      return projectPhysicalIssue(parsed.locator, error);
    }
  }

  const runtime: ConversationFileLinkRuntimePort = {
    async resolve(request) {
      const parsed = parseFileLocator(request.locator);
      const resolution = parsed.kind === 'workspace'
        ? await resolveWorkspace(request, parsed)
        : await resolvePhysical(request, parsed);
      return ConversationFileLinkResolutionSchema.parse(resolution);
    },
    async reveal(request, revealFile) {
      const parsed = parseFileLocator(request.locator);
      if (parsed.kind === 'workspace') {
        throw new Error('[CONVERSATION_FILE_LINK_REVEAL_KIND_INVALID] Workspace 文件必须在应用内打开。');
      }
      await withPhysicalTarget({
        parsed,
        conversationId: request.conversation_id,
        admission: input.conversationWorkDirectoryAdmission,
        use: async target => {
          const inspected = await inspectNodePhysicalRegularFile(target);
          // conversation admission 必须覆盖 shell 调用，不能在释放删除 barrier 后再使用路径。
          await revealFile(inspected.resolvedPath);
        },
      });
    },
  };
  return Object.freeze(runtime);
}
