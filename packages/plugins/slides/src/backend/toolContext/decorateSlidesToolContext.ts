/**
 * @file decorateSlidesToolContext.ts
 * @description Slides 工具上下文装饰器（阶段 5BB：已从 legacy bridge 迁入包内）。
 *
 * 中文说明：
 * - 给 ToolContext 附加 coordinator lazy provider 与 ppt_inspect 目标解析器；
 * - 插件启停门禁走通用 `@plugin/backend/pluginRuntime` 平台门面；
 * - workspace VFS 节点解析走 `@plugin/backend/workspaceRuntime` 平台门面，
 *   插件不感知 db 连接与节点可见性策略的实现细节；
 * - 本文件不允许 deep import host 内部路径。
 */

import type { Database } from 'better-sqlite3';
import { assertPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import {
  createConversationFilePathResolver,
  resolveWorkspaceVfsNodeForPluginTool,
} from '@plugin/backend/workspaceRuntime';
import type { ToolContext } from '@plugin/backend/toolRuntime';
import { SLIDES_PLUGIN_META } from '@plugin/slides/shared';
import { getSharedPptCoordinator } from '../coordinator';
import {
  attachPresentationCoordinatorProviderToToolContext,
  attachPresentationInspectTargetResolverToToolContext,
  type PresentationCoordinatorProvider,
  type PresentationInspectTargetResolver,
  type PresentationToolCoordinatorPort,
} from '../tools';

interface SlidesToolDatabaseService {
  getDb(): Database;
}

function isDatabaseService(value: unknown): value is SlidesToolDatabaseService {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'getDb') === 'function';
}

function createPresentationCoordinatorProvider(context: ToolContext): PresentationCoordinatorProvider {
  return () => {
    assertPluginRuntimeEnabled({
      pluginId: SLIDES_PLUGIN_META.id,
      pluginName: SLIDES_PLUGIN_META.name,
      action: '使用 Slides 工具',
    });

    if (!isDatabaseService(context.databaseService)) {
      throw new Error('Workspace database not available in tool context.');
    }
    const conversationFilePathResolver = createConversationFilePathResolver(context);
    return conversationFilePathResolver
      ? getSharedPptCoordinator(context.databaseService.getDb(), {
          conversationFilePathResolver,
        })
      : getSharedPptCoordinator(context.databaseService.getDb());
  };
}

function createPresentationInspectTargetResolver(context: ToolContext): PresentationInspectTargetResolver {
  return async (input) => {
    const resolved = await resolveWorkspaceVfsNodeForPluginTool(context, {
      path: input.path,
      inode: input.inode,
    });
    if (!resolved.ok) {
      throw new Error(resolved.hint ? `${resolved.message} ${resolved.hint}` : resolved.message);
    }
    if (resolved.node.type !== 'presentation') {
      throw new Error(`ppt_inspect 只能检查 Slides 文件，当前路径类型: ${resolved.node.type}`);
    }

    return {
      presentationId: resolved.node.id,
      path: resolved.node.path,
      inode: resolved.node.inode,
    };
  };
}

function isToolContextLike(value: unknown): value is ToolContext {
  return typeof value === 'object' && value !== null;
}

function readToolContext(value: unknown): ToolContext {
  if (!isToolContextLike(value)) {
    throw new Error('Slides tool context decorator requires ToolContext-like host object.');
  }
  return value;
}

export function decorateSlidesToolContext(contextValue: unknown): void {
  const context = readToolContext(contextValue);
  attachPresentationCoordinatorProviderToToolContext(
    context,
    createPresentationCoordinatorProvider(context),
    createPresentationCoordinatorProvider,
  );
  attachPresentationInspectTargetResolverToToolContext(
    context,
    createPresentationInspectTargetResolver(context),
    createPresentationInspectTargetResolver,
  );
}
