import {
  HistoricalWorkspaceFileLifecycleArgsSchema,
  HistoricalWorkspaceWriteFileArgsSchema,
  HistoricalWorkspaceWriteFileResultSchema,
  WorkspaceFileLifecycleArgsSchema,
  WorkspaceWriteFileArgsSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import type {
  ToolCompactStepProjectorInput,
  ToolCompactStepPresentation,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import type { WorkspaceWriteFilePresentationData } from '../definitions/workspaceFileHeaderPresentation';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import {
  createWorkspaceFileActionTitle,
  formatWorkspaceFileTarget,
} from './createWorkspaceFileActionTitle';

export function projectWorkspaceWriteFilePresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<WorkspaceWriteFilePresentationData> {
  if (input.sourceToolName !== 'write_file' || input.uiKey !== 'write_file') {
    throw new Error(
      `Unsupported Workspace write presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }

  if (input.status !== 'success') {
    const liveArgs = WorkspaceFileLifecycleArgsSchema.safeParse(input.args);
    const liveTarget = liveArgs.success
      ? [liveArgs.data.locator, liveArgs.data.inode].find(
          value => typeof value === 'string' && value.trim().length > 0
        )
      : undefined;
    const historicalArgs =
      liveTarget === undefined
        ? HistoricalWorkspaceFileLifecycleArgsSchema.parse(input.args)
        : undefined;
    const rawTarget =
      liveTarget ??
      [historicalArgs?.path, historicalArgs?.inode].find(
        value => typeof value === 'string' && value.trim().length > 0
      );
    if (rawTarget === undefined) {
      return {
        data: { kind: 'lifecycle' },
        title: createConversationToolTitleDescriptor(
          'conversation.tool.workspace.file.createLoading'
        ),
      };
    }
    const requestTarget = formatWorkspaceFileTarget(rawTarget);
    return {
      data: { kind: 'lifecycle', target: requestTarget },
      title: createWorkspaceFileActionTitle({
        actionKey: 'conversation.tool.workspace.file.write',
        titleKey: 'conversation.tool.workspace.file.writeTarget',
        target: requestTarget,
      }),
    };
  }

  const liveResult = WorkspaceWriteFileResultSchema.safeParse(input.result);
  const resolved = liveResult.success
    ? (() => {
        WorkspaceWriteFileArgsSchema.parse(input.args);
        return {
          data: liveResult.data.data,
          locator: liveResult.data.data.locator,
          createdFolders: liveResult.data.data.created_folders ?? [],
        };
      })()
    : (() => {
        HistoricalWorkspaceWriteFileArgsSchema.parse(input.args);
        const historicalResult = HistoricalWorkspaceWriteFileResultSchema.parse(input.result);
        return {
          data: historicalResult.data,
          locator: `workspace:${historicalResult.data.path}`,
          createdFolders: [],
        };
      })();
  const target = formatWorkspaceFileTarget(resolved.data.node.name);
  const title = createWorkspaceFileActionTitle({
    actionKey: 'conversation.tool.workspace.file.write',
    titleKey: 'conversation.tool.workspace.file.writeTarget',
    target,
    document: {
      inode: resolved.data.inode,
      node: resolved.data.node,
    },
  });

  return {
    data: {
      kind: 'snapshot',
      locator: resolved.locator,
      operation: resolved.data.operation,
      createdFolders: resolved.createdFolders,
      diagnosticCount:
        (resolved.data.diagnostics?.length ?? 0) + (resolved.data.diagnosticsTruncatedCount ?? 0),
    },
    title:
      resolved.data.operation === 'create'
        ? {
            ...title,
            tag: {
              text: createConversationToolTitleDescriptor(
                resolved.createdFolders.length > 0
                  ? 'conversation.tool.workspace.document.createdWithFoldersTag'
                  : 'conversation.tool.workspace.document.createdTag',
                resolved.createdFolders.length > 0
                  ? { count: resolved.createdFolders.length }
                  : undefined
              ).text,
              variant: 'success',
            },
          }
        : title,
  };
}

/** 紧凑轨迹只读取成功回执中的目录计数；旧回执与运行中/失败仍使用原写入标题。 */
export function projectWorkspaceWriteFileCompactStep(
  input: ToolCompactStepProjectorInput
): ToolCompactStepPresentation {
  if (input.status === 'success') {
    const result = WorkspaceWriteFileResultSchema.safeParse(input.result);
    // 历史成功事件沿冻结合同读取，不能把畸形的新回执降为通用标题。
    if (!result.success) HistoricalWorkspaceWriteFileResultSchema.parse(input.result);
    const count = result.success ? (result.data.data.created_folders?.length ?? 0) : 0;
    if (count > 0) {
      return {
        title: createConversationToolTitleDescriptor(
          'conversation.tool.workspace.compact.writeWithFolders',
          { count }
        ).text,
      };
    }
  }
  return {
    title: createConversationToolTitleDescriptor('conversation.tool.workspace.compact.write').text,
  };
}
