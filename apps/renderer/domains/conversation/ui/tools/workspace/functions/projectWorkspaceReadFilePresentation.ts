import {
  HistoricalWorkspaceReadFileArgsSchema,
  HistoricalWorkspaceReadFileEventResultSchema,
  HistoricalWorkspaceReadFileLifecycleArgsSchema,
  WorkspaceReadFileArgsSchema,
  WorkspaceReadFileEventResultSchema,
  WorkspaceReadFileLifecycleArgsSchema,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import type { WorkspaceReadFilePresentationData } from '../definitions/workspaceFileHeaderPresentation';
import {
  createWorkspaceFileActionTitle,
  formatWorkspaceFileTarget,
} from './createWorkspaceFileActionTitle';

export function projectWorkspaceReadFilePresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<WorkspaceReadFilePresentationData> {
  if (input.sourceToolName !== 'read_file' || input.uiKey !== 'workspace_read_file') {
    throw new Error(
      `Unsupported Workspace read presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }

  if (input.status !== 'success') {
    const liveArgs = WorkspaceReadFileLifecycleArgsSchema.safeParse(input.args);
    const liveTarget = liveArgs.success
      ? [liveArgs.data.locator, liveArgs.data.inode]
          .find(value => typeof value === 'string' && value.trim().length > 0)
      : undefined;
    const historicalArgs = liveTarget === undefined
      ? HistoricalWorkspaceReadFileLifecycleArgsSchema.parse(input.args)
      : undefined;
    const rawTarget = liveTarget
      ?? [historicalArgs?.path, historicalArgs?.inode]
        .find(value => typeof value === 'string' && value.trim().length > 0)
      ?? 'file';
    const requestTarget = formatWorkspaceFileTarget(rawTarget);
    return {
      data: { kind: 'lifecycle', target: requestTarget },
      title: createWorkspaceFileActionTitle({
        actionKey: 'conversation.tool.workspace.file.read',
        titleKey: 'conversation.tool.workspace.file.readTarget',
        target: requestTarget,
      }),
    };
  }

  const liveResult = WorkspaceReadFileEventResultSchema.safeParse(input.result);
  if (liveResult.success) {
    WorkspaceReadFileArgsSchema.parse(input.args);
    const data = liveResult.data.data;
    const target = data.source_kind === 'workspace_vfs'
      ? formatWorkspaceFileTarget(data.node.name)
      : data.source_kind === 'workspace_document'
        ? formatWorkspaceFileTarget(data.document.documentName)
        : formatWorkspaceFileTarget(data.file_name);
    const document = data.source_kind === 'workspace_vfs'
      ? { inode: data.inode, node: data.node }
      : undefined;
    const structuredDocument = data.source_kind === 'workspace_document'
      ? data.document
      : undefined;
    return {
      data: {
        kind: 'snapshot',
        locator: data.locator,
        contentType: data.content_type,
        hasMore: 'has_more' in data ? data.has_more : false,
        ...(structuredDocument ? { document: structuredDocument } : {}),
      },
      title: createWorkspaceFileActionTitle({
        actionKey: 'conversation.tool.workspace.file.read',
        titleKey: 'conversation.tool.workspace.file.readTarget',
        target,
        ...(document ? { document } : {}),
      }),
    };
  }

  HistoricalWorkspaceReadFileArgsSchema.parse(input.args);
  const historical = HistoricalWorkspaceReadFileEventResultSchema.parse(input.result);
  const target = 'node' in historical.data
    ? formatWorkspaceFileTarget(historical.data.node.name)
    : historical.data.source === 'workspace_document'
      ? formatWorkspaceFileTarget(historical.data.document.documentName)
      : formatWorkspaceFileTarget(historical.data.file_name);
  const document = 'node' in historical.data
    ? { inode: historical.data.inode, node: historical.data.node }
    : undefined;
  const structuredDocument = 'source' in historical.data
    && historical.data.source === 'workspace_document'
    ? historical.data.document
    : undefined;
  const locator = 'source' in historical.data && historical.data.source === 'conversation_file'
    ? `conversation:/${historical.data.relative_path.replace(/^\/+/, '')}`
    : `workspace:${historical.data.path}`;
  return {
    data: {
      kind: 'snapshot',
      locator,
      contentType: historical.data.content_type,
      hasMore: 'has_more' in historical.data ? historical.data.has_more : false,
      ...(structuredDocument ? { document: structuredDocument } : {}),
    },
    title: createWorkspaceFileActionTitle({
      actionKey: 'conversation.tool.workspace.file.read',
      titleKey: 'conversation.tool.workspace.file.readTarget',
      target,
      ...(document ? { document } : {}),
    }),
  };
}
