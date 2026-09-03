import {
  HistoricalWorkspaceFileLifecycleArgsSchema,
  HistoricalWorkspaceWriteFileArgsSchema,
  HistoricalWorkspaceWriteFileResultSchema,
  WorkspaceFileLifecycleArgsSchema,
  WorkspaceWriteFileArgsSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import type {
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
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<WorkspaceWriteFilePresentationData> {
  if (input.sourceToolName !== 'write_file' || input.uiKey !== 'write_file') {
    throw new Error(
      `Unsupported Workspace write presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }

  if (input.status !== 'success') {
    const liveArgs = WorkspaceFileLifecycleArgsSchema.safeParse(input.args);
    const liveTarget = liveArgs.success
      ? [liveArgs.data.locator, liveArgs.data.inode]
          .find(value => typeof value === 'string' && value.trim().length > 0)
      : undefined;
    const historicalArgs = liveTarget === undefined
      ? HistoricalWorkspaceFileLifecycleArgsSchema.parse(input.args)
      : undefined;
    const rawTarget = liveTarget
      ?? [historicalArgs?.path, historicalArgs?.inode]
        .find(value => typeof value === 'string' && value.trim().length > 0);
    if (rawTarget === undefined) {
      return {
        data: { kind: 'lifecycle' },
        title: createConversationToolTitleDescriptor(
          'conversation.tool.workspace.file.createLoading',
        ),
      };
    }
    const requestTarget = formatWorkspaceFileTarget(
      rawTarget,
    );
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
        };
      })()
    : (() => {
        HistoricalWorkspaceWriteFileArgsSchema.parse(input.args);
        const historicalResult = HistoricalWorkspaceWriteFileResultSchema.parse(input.result);
        return {
          data: historicalResult.data,
          locator: `workspace:${historicalResult.data.path}`,
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
      diagnosticCount:
        (resolved.data.diagnostics?.length ?? 0)
        + (resolved.data.diagnosticsTruncatedCount ?? 0),
    },
    title: resolved.data.operation === 'create'
      ? {
          ...title,
          tag: {
            text: createConversationToolTitleDescriptor(
              'conversation.tool.workspace.document.createdTag',
            ).text,
            variant: 'success',
          },
        }
      : title,
  };
}
