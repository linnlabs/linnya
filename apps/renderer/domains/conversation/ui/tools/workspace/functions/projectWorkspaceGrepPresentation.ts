import {
  HistoricalWorkspaceGrepArgsSchema,
  HistoricalWorkspaceGrepLifecycleArgsSchema,
  HistoricalWorkspaceGrepResultSchema,
  WorkspaceGrepLifecycleArgsSchema,
  WorkspaceGrepArgsSchema,
  WorkspaceGrepResultSchema,
} from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import type { WorkspaceGrepPresentationData } from '../definitions/workspaceFileHeaderPresentation';

export function projectWorkspaceGrepPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<WorkspaceGrepPresentationData> {
  if (input.sourceToolName !== 'grep' || input.uiKey !== 'grep') {
    throw new Error(
      `Unsupported Workspace grep presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }

  if (input.status !== 'success') {
    const liveArgs = WorkspaceGrepLifecycleArgsSchema.safeParse(input.args);
    const lifecycleArgs = liveArgs.success
      ? liveArgs.data
      : HistoricalWorkspaceGrepLifecycleArgsSchema.parse(input.args);
    const title = createConversationToolTitleDescriptor(
      'conversation.tool.workspace.searchWithPattern',
      { pattern: lifecycleArgs.pattern?.trim() || '...' },
    );
    return {
      data: { kind: 'lifecycle', pattern: lifecycleArgs.pattern?.trim() || '...' },
      title,
    };
  }

  const liveResult = WorkspaceGrepResultSchema.safeParse(input.result);
  const args = liveResult.success
    ? WorkspaceGrepArgsSchema.parse(input.args)
    : HistoricalWorkspaceGrepArgsSchema.parse(input.args);
  const title = createConversationToolTitleDescriptor(
    'conversation.tool.workspace.searchWithPattern',
    { pattern: args.pattern },
  );
  const result = liveResult.success
    ? liveResult.data
    : HistoricalWorkspaceGrepResultSchema.parse(input.result);
  if (result.data.pattern !== args.pattern) {
    throw new Error(
      `Workspace grep result pattern does not match request: ${result.data.pattern}`,
    );
  }
  return {
    data: {
      kind: 'snapshot',
      pattern: result.data.pattern,
      totalCount: result.data.total_count,
      truncated: result.data.truncated,
    },
    title,
  };
}
