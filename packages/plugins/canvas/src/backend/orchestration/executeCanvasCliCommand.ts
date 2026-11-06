import { randomUUID } from 'node:crypto';
import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import { resolveWorkspaceDocumentPath } from '@plugin/backend/workspaceDocumentProjection';
import { CanvasRenderRequestSchema } from '../../shared/rendering';
import {
  CANVAS_DEFAULT_FONT_FAMILY,
  CANVAS_DEFAULT_FONT_SIZE,
} from '../../shared/rendering/definitions/canvasTypography';
import { CanvasCliFailure, type CanvasCliCommand } from '../features/canvasCli';
import {
  readCanvasDocumentIdentity,
  readCanvasProjectionContext,
} from '../features/canvasDocument';
import { canvasSourceKey, readCanvasSnapshot } from '../features/canvasCommit';
import {
  readCanvasAgentGroups,
  projectCanvasAgentGroup,
  findCanvasPendingApproval,
  readCanvasAgentRequestStatuses,
  readCanvasAgentRequestStatus,
  projectCanvasAgentReceiptQuery,
} from '../features/agentChanges';
import { queryCanvas, readCanvasRenderRegion } from '../features/canvasQuery';
import { publishCanvasImage } from '../features/canvasExport';
import { readCanvasHostDatabase } from '../functions/readCanvasHostContext';
import { executeCanvasCliWrite } from './executeCanvasCliWrite';
import { projectCanvasCliSnapshot } from './projectCanvasCliSnapshot';
import { readCanvasRenderingResources } from './readCanvasRenderingResources';
import type { CanvasCliScope, CanvasCliServices } from './definitions/canvasCliExecution';

export async function executeCanvasCliCommand(
  command: Exclude<CanvasCliCommand, { kind: 'help' }>,
  context: BackendPluginCliExecutionContext,
  conversationRoot: string,
  services: CanvasCliServices
) {
  const scope = resolveScope(command.path, context, conversationRoot);
  if (command.kind === 'apply' || command.kind === 'arrange')
    return executeCanvasCliWrite(command, scope, services);
  if (command.kind === 'receipt')
    return projectCanvasAgentReceiptQuery(
      command.path,
      readCanvasAgentRequestStatus(
        scope.database,
        scope.documentId,
        canvasSourceKey(scope.actor),
        command.requestId
      )
    );
  const snapshot = readCanvasSnapshot(scope.database, scope.documentId);
  if (command.kind === 'check') {
    const result = await services.capabilities.computation.check(snapshot, context.signal);
    context.signal.throwIfAborted();
    readCanvasDocumentIdentity(scope.database, scope.documentId, scope.projectId);
    return result;
  }
  if (command.kind === 'groups')
    return {
      sequence: snapshot.sequence,
      groups: readCanvasAgentGroups(scope.database, scope.documentId)
        .map(group =>
          projectCanvasAgentGroup(
            group,
            findCanvasPendingApproval(scope.database, scope.documentId, group.id)?.approval ?? null,
            Date.now()
          )
        )
        .map((group, index) => ({
          group: index + 1,
          currentConversation: group.conversationId === context.conversationId,
          writing: group.writing,
          added: group.added,
          updated: group.updated,
          deleted: group.deleted,
          pending: group.pendingApproval
            ? {
                requestId: group.pendingApproval.requestId,
                reason: group.pendingApproval.reason,
                operationCount: group.pendingApproval.operationCount,
              }
            : null,
        })),
      approvals: readCanvasAgentRequestStatuses(
        scope.database,
        scope.documentId,
        context.conversationId ?? null
      ).map(({ requestId, status, commit }) => ({ requestId, status, sequence: commit?.sequence })),
    };
  if (command.kind === 'render') {
    const resources = await readCanvasRenderingResources({
      database: scope.database,
      snapshot,
      signal: context.signal,
      covers: true,
    });
    const check = await services.capabilities.computation.check(snapshot, context.signal);
    readCanvasDocumentIdentity(scope.database, scope.documentId, scope.projectId);
    const result = await services.capabilities.rendering.render(
      CanvasRenderRequestSchema.parse({
        protocol: 1,
        requestId: randomUUID(),
        kind: 'render',
        snapshot,
        ...resources,
        theme: command.theme,
        width: command.width,
        height: command.height,
        dpr: 1,
        fontFamily: CANVAS_DEFAULT_FONT_FAMILY,
        fontSize: CANVAS_DEFAULT_FONT_SIZE,
        format: command.format,
        quality: 0.9,
        material: 'paper',
        region: readCanvasRenderRegion(snapshot, command),
      }),
      context.signal
    );
    const locator = await publishCanvasImage({
      conversationRoot,
      bytes: result.bytes,
      format: result.format,
      signal: context.signal,
      assertScope: () => {
        readCanvasDocumentIdentity(scope.database, scope.documentId, scope.projectId);
      },
    });
    return {
      sequence: result.sequence,
      locator,
      width: result.width,
      height: result.height,
      format: result.format,
      check,
      checkScope: 'canvas',
    };
  }
  const projected = projectCanvasCliSnapshot(
    snapshot,
    services.referencesFor(scope.database),
    scope.readerId
  );
  return queryCanvas(projected, readCanvasProjectionContext(scope.database, snapshot), command);
}
function resolveScope(
  path: string,
  context: BackendPluginCliExecutionContext,
  conversationRoot: string
): CanvasCliScope {
  if (!context.projectId || !context.conversationId || !context.agentRunId)
    throw new CanvasCliFailure(
      'context_required',
      '需要当前 App 中已授权的项目对话与 Agent run；不接受命令行代填身份。'
    );
  const database = readCanvasHostDatabase(context.hostContext);
  const node = resolveWorkspaceDocumentPath(database, { projectId: context.projectId, path });
  if (!node)
    throw new CanvasCliFailure(
      'document_missing',
      '画布路径不存在或不在当前项目，请先列出 Workspace 路径。'
    );
  readCanvasDocumentIdentity(database, node.id, context.projectId);
  const readerId = JSON.stringify([context.conversationId, context.agentRunId]);
  return {
    database,
    documentId: node.id,
    projectId: context.projectId,
    readerId,
    context,
    conversationRoot,
    actor: {
      projectId: context.projectId,
      source: { kind: 'agent', conversationId: context.conversationId, runId: context.agentRunId },
      viewId: `cli:${readerId}`,
    },
  };
}
