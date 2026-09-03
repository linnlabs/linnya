import {
  HistoricalWorkspaceListFilesArgsSchema,
  HistoricalWorkspaceListFilesResultSchema,
  WorkspaceListFilesArgsSchema,
  WorkspaceListFilesResultSchema,
} from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import type { WorkspaceListFilesPresentationData } from '../definitions/workspaceFileHeaderPresentation';

export function projectWorkspaceListFilesPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<WorkspaceListFilesPresentationData> {
  if (input.sourceToolName !== 'list_files' || input.uiKey !== 'list_files') {
    throw new Error(
      `Unsupported Workspace list presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }

  const title = createConversationToolTitleDescriptor('conversation.tool.workspace.files.list');
  if (input.status !== 'success') {
    return { data: { kind: 'lifecycle' }, title };
  }

  // success 才允许使用正式执行 schema；loading/update 只消费上面的生命周期合同。
  const liveResult = WorkspaceListFilesResultSchema.safeParse(input.result);
  if (liveResult.success) {
    WorkspaceListFilesArgsSchema.parse(input.args);
    return {
      data: {
        kind: 'snapshot',
        locator: liveResult.data.data.locator,
        totalCount: liveResult.data.data.total_count,
        hasMore: liveResult.data.data.has_more,
      },
      title,
    };
  }

  HistoricalWorkspaceListFilesArgsSchema.parse(input.args);
  const historical = HistoricalWorkspaceListFilesResultSchema.parse(input.result);
  return {
    data: {
      kind: 'snapshot',
      locator: `workspace:${historical.data.path}`,
      totalCount: historical.data.total_count,
      hasMore: historical.data.has_more,
    },
    title,
  };
}
