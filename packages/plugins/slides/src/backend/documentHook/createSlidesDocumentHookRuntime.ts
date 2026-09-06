/**
 * @file createSlidesDocumentHookRuntime.ts
 * @description Slides document hook 的运行时装配（阶段 5BD：已从 legacy bridge 迁入包内）。
 *
 * 中文说明：
 * - 优先复用工具执行期已注入的 coordinator（toolContextDecorators 装饰结果）；
 * - 没有注入时按 ToolContext 里的 databaseService 读取包内共享 coordinator；
 * - workspace 节点改名等能力通过 `@plugin/backend/workspaceRuntime` 窄门面消费；
 * - 本文件不允许 deep import host 内部路径。
 */

import type { Database } from 'better-sqlite3';
import { DocumentHistoryError, type DocumentHistoryCapability } from '@plugin/backend/documentHistory';
import {
  createWorkspaceService,
  type PluginWorkspaceServicePort,
} from '@plugin/backend/workspaceRuntime';
import {
  readPresentationCoordinatorFromToolContext,
  type PresentationToolCoordinatorPort,
} from '@plugin/slides/backend-tools';
import { getSharedPptCoordinator } from '@plugin/slides/backend-coordinator';
import type {
  SlidesDocumentHookRuntime,
  SlidesDocumentHookRuntimeFactory,
} from './presentationDocumentHookRuntime';

interface SlidesHookDatabaseService {
  getDb(): Database;
}

interface SlidesHookToolContext {
  readonly databaseService?: SlidesHookDatabaseService;
  readonly workspaceService?: PluginWorkspaceServicePort;
  readonly [key: string]: unknown;
}

function isDatabaseService(value: unknown): value is SlidesHookDatabaseService {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'getDb') === 'function'
  );
}

function isWorkspaceServiceLike(value: unknown): value is PluginWorkspaceServicePort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'getNode') === 'function' &&
    typeof Reflect.get(value, 'renameNode') === 'function'
  );
}

function readToolContext(value: unknown): SlidesHookToolContext {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Slides document hook requires ToolContext-like host object.');
  }
  return value as SlidesHookToolContext;
}

function readDatabaseService(context: SlidesHookToolContext): SlidesHookDatabaseService {
  if (!isDatabaseService(context.databaseService)) {
    throw new Error('Workspace database not available in tool context.');
  }
  return context.databaseService;
}

function readWorkspaceService(context: SlidesHookToolContext): PluginWorkspaceServicePort {
  if (isWorkspaceServiceLike(context.workspaceService)) {
    return context.workspaceService;
  }
  return createWorkspaceService(readDatabaseService(context).getDb());
}

function readFallbackPresentationCoordinator(
  context: SlidesHookToolContext
): PresentationToolCoordinatorPort {
  return getSharedPptCoordinator(readDatabaseService(context).getDb());
}

export const createSlidesDocumentHookRuntime: SlidesDocumentHookRuntimeFactory = (
  contextValue: unknown
): SlidesDocumentHookRuntime => {
  const context = readToolContext(contextValue);
  const readStablePresentationCoordinator = (): PresentationToolCoordinatorPort => {
    const injectedCoordinator = readPresentationCoordinatorFromToolContext(context);
    if (injectedCoordinator) {
      return injectedCoordinator;
    }
    return readFallbackPresentationCoordinator(context);
  };
  const readStableCodegenPresentationService = () =>
    readStablePresentationCoordinator().getCodegenPresentationService();

  return {
    async createEmptyPresentation(input) {
      return readStablePresentationCoordinator().createEmptyPresentation(input);
    },
    async writeSource(input, writeContext) {
      const result = await readStableCodegenPresentationService().write(
        {
          ...(input.presentationId ? { presentation_id: input.presentationId } : {}),
          source: input.source,
          ...(input.expectedSourceKey ? { expected_source_key: input.expectedSourceKey } : {}),
        },
        {
          conversationId: writeContext.conversationId,
          projectId: writeContext.projectId,
          ...(writeContext.parentId ? { parentId: writeContext.parentId } : {}),
          ...(writeContext.requestedTitle
            ? { requestedTitle: writeContext.requestedTitle }
            : {}),
        }
      );
      return {
        presentationId: result.presentationId,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        buildStatus: result.buildStatus,
        diagnostics: result.diagnostics,
        ...(result.draftStatus ? { draftStatus: result.draftStatus } : {}),
        ...(result.buildFailure ? { buildFailure: result.buildFailure } : {}),
      };
    },
    async readSource(input) {
      return readStableCodegenPresentationService().read(
        { presentation_id: input.presentationId },
        { conversationId: input.conversationId }
      );
    },
    renameCreatedNodeToRequestedFileName(input) {
      const workspaceService = readWorkspaceService(context);
      const node = workspaceService.getNode(input.nodeId);
      if (!node || node.name === input.fileName) return;
      // Codegen builder 会先按 deck 标题建节点；hook 收尾时再对齐用户请求的文件名。
      workspaceService.renameNode(input.nodeId, input.fileName);
    },
  };
};

export const slidesDocumentHistoryCapability: DocumentHistoryCapability = {
  list(input) {
    const coordinator = getSharedPptCoordinator(readDatabaseService(readToolContext(input.context)).getDb());
    if (!coordinator.history) throw new DocumentHistoryError('history_unavailable');
    return coordinator.history.list(input.documentId);
  },
  async restore(input) {
    const coordinator = getSharedPptCoordinator(readDatabaseService(readToolContext(input.context)).getDb());
    if (!coordinator.history) throw new DocumentHistoryError('history_unavailable');
    return coordinator.history.restore(input);
  },
};
