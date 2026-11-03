import { JsonValueSchema } from '@app/schemas';
import { CanvasCliBatchSchema, CANVAS_CLI_VERSION } from '../../shared/cli/definitions/canvasCli';
import { CanvasCommitRequestSchema, type CanvasLayoutDiagnostic, type CanvasSnapshot } from '../../shared';
import { readCanvasInputFile, type CanvasCliCommand } from '../features/canvasCli';
import { readCanvasEditingClaims } from '../features/canvasCommit';
import { prepareCanvasWrite, resolveCanvasLayoutOptions, bindCanvasLayout } from '../features/canvasWrite';
import { createCanvasWritePreparationPorts } from '../adapters/createCanvasWritePreparationPorts';
import type { CanvasCliScope, CanvasCliServices } from './definitions/canvasCliExecution';

export async function executeCanvasCliWrite(command: Extract<CanvasCliCommand, { kind: 'apply' | 'arrange' }>, scope: CanvasCliScope, services: CanvasCliServices) {
  const operations = command.kind === 'arrange' ? CanvasCliBatchSchema.parse([{ op: 'arrange', ...command.options }])
    : CanvasCliBatchSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readCanvasInputFile(scope.conversationRoot, command.file, scope.context.signal))));
  const payloadIdentity = JsonValueSchema.parse({ kind: 'canvas-cli', version: CANVAS_CLI_VERSION, operations });
  const document = services.runtimeFor(scope.database);
  const replay = document.editing.replayAgentRequest({ documentId: scope.documentId, requestId: command.requestId, actor: scope.actor, payloadIdentity });
  // 诊断属于本次计算窗口；正式提交回执在重试时逐字段复用，绝不重算布局。
  if (replay) return { ...projectCanvasAgentReceipt(replay), diagnostics: [] };
  const snapshot = document.read(scope.documentId, scope.projectId);
  const preparation = createCanvasWritePreparationPorts({ ...scope, snapshot, requestId: command.requestId, dryRun: command.dryRun,
    references: services.referencesFor(scope.database), capabilities: services.capabilities });
  const prepared = await prepareCanvasWrite({ snapshot, operations, dryRun: command.dryRun, signal: scope.context.signal }, preparation.ports);
  let request = CanvasCommitRequestSchema.parse({ documentId: scope.documentId, requestId: command.requestId, operations: prepared.operations,
    referenceBindings: preparation.readBindings(), payloadIdentity });
  let diagnostics: readonly CanvasLayoutDiagnostic[] = [];
  if (prepared.arrange) {
    const preview = document.editing.preview({ request, actor: scope.actor, now: Date.now() });
    const planned: CanvasSnapshot = { schemaVersion: 1, documentId: scope.documentId, sequence: preview.state.sequence, elements: preview.state.elements.map(row => row.element) };
    const options = resolveCanvasLayoutOptions(prepared.arrange, preview.refs);
    const protectedElementIds = readCanvasEditingClaims(scope.database, { documentId: scope.documentId, viewId: scope.actor.viewId, now: Date.now() })
      .filter(claim => claim.fields.some(field => ['x', 'y', 'width', 'height'].includes(field))).map(claim => claim.elementId);
    const layout = await services.capabilities.computation.layout({ ...options, snapshot: planned, protectedElementIds }, scope.context.signal);
    const bound = bindCanvasLayout(layout, preview.refs, options.groups);
    request = { ...request, operations: [...request.operations, ...bound.operations], layoutGroups: bound.layoutGroups };
    diagnostics = layout.diagnostics;
  }
  scope.context.signal.throwIfAborted();
  services.referencesFor(scope.database).assertBindings({ sourceDocumentId: scope.documentId, bindings: request.referenceBindings ?? [] });
  if (command.dryRun) {
    const preview = document.editing.preview({ request, actor: scope.actor, now: Date.now() });
    return { status: 'dry-run', tentative: true, sequence: preview.state.sequence, refs: preview.refs, results: preview.results, diagnostics,
      planned: preview.state.elements.filter(row => preview.changes.some(change => change.id === row.element.id)).map(row => row.element.type === 'edge' ? { id: row.element.id, type: row.element.type } : { id: row.element.id, type: row.element.type, x: row.element.x, y: row.element.y, width: row.element.width, height: row.element.height }),
      note: '没有写入。ID/位置仅为预测，正式提交仍按最新占用计算；使用本批临时ref连接新卡。' };
  }
  const result = document.editing.commitAgent({ request, actor: scope.actor, now: Date.now(), intent: prepared.arrange ? 'arrange' : 'apply', payloadIdentity });
  return { ...projectCanvasAgentReceipt(result), diagnostics };
}
function projectCanvasAgentReceipt(result: import('../../shared').CanvasAgentCommitResult) {
  if (result.kind === 'committed') return { status: 'committed', requestId: result.commit.requestId, sequence: result.commit.sequence, refs: result.commit.refs, results: result.commit.results };
  return { status: 'pending', requestId: result.approval.requestId, reason: result.approval.reason, operationCount: result.approval.operationCount,
    elementIds: result.approval.elementIds, message: '本批尚未执行，等待用户在画布中点允许或不允许。请在回复中提醒用户，不能用CLI代替批准。' };
}
