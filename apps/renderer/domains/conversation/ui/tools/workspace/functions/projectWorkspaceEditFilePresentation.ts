import {
  HistoricalWorkspaceEditFileArgsSchema,
  HistoricalWorkspaceEditFileResultSchema,
  HistoricalWorkspaceFileLifecycleArgsSchema,
  WorkspaceEditFileArgsSchema,
  WorkspaceEditFileResultSchema,
  WorkspaceFileLifecycleArgsSchema,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import type { WorkspaceEditFilePresentationData } from '../definitions/workspaceFileHeaderPresentation';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import {
  createWorkspaceFileActionTitle,
  formatWorkspaceFileTarget,
} from './createWorkspaceFileActionTitle';

export function projectWorkspaceEditFilePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<WorkspaceEditFilePresentationData> {
  if (input.sourceToolName !== 'edit_file' || input.uiKey !== 'edit_file') {
    throw new Error(
      `Unsupported Workspace edit presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
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
          'conversation.tool.workspace.file.editLoading',
        ),
      };
    }
    const requestTarget = formatWorkspaceFileTarget(
      rawTarget,
    );
    return {
      data: { kind: 'lifecycle', target: requestTarget },
      title: createWorkspaceFileActionTitle({
        actionKey: 'conversation.tool.workspace.file.edit',
        titleKey: 'conversation.tool.workspace.file.editTarget',
        target: requestTarget,
      }),
    };
  }

  const liveResult = WorkspaceEditFileResultSchema.safeParse(input.result);
  const resolved = liveResult.success
    ? (() => {
        WorkspaceEditFileArgsSchema.parse(input.args);
        return {
          data: liveResult.data.data,
          locator: liveResult.data.data.locator,
        };
      })()
    : (() => {
        HistoricalWorkspaceEditFileArgsSchema.parse(input.args);
        const historicalResult = HistoricalWorkspaceEditFileResultSchema.parse(input.result);
        return {
          data: historicalResult.data,
          locator: `workspace:${historicalResult.data.path}`,
        };
      })();
  const target = formatWorkspaceFileTarget(resolved.data.node.name);
  return {
    data: {
      kind: 'snapshot',
      locator: resolved.locator,
      replaced: resolved.data.replaced,
      diagnosticCount:
        (resolved.data.diagnostics?.length ?? 0)
        + (resolved.data.diagnosticsTruncatedCount ?? 0),
    },
    title: createWorkspaceFileActionTitle({
      actionKey: 'conversation.tool.workspace.file.edit',
      titleKey: 'conversation.tool.workspace.file.editTarget',
      target,
      document: {
        inode: resolved.data.inode,
        node: resolved.data.node,
      },
    }),
  };
}
