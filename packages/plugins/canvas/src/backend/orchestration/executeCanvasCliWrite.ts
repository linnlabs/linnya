import { prepareCanvasCliArrangement } from './prepareCanvasCliArrangement';
import { JsonValueSchema } from '@app/schemas';
import { CanvasCliBatchSchema, CANVAS_CLI_VERSION } from '../../shared/cli/definitions/canvasCli';
import {
  CanvasCommitRequestSchema,
  type CanvasLayoutDiagnostic,
  type CanvasLayoutComputation,
} from '../../shared';
import { readCanvasInputFile, type CanvasCliCommand } from '../features/canvasCli';
import { prepareCanvasWrite } from '../features/canvasWrite';
import { findCanvasSectionOverlaps } from '../features/canvasQuery';
import { createCanvasWritePreparationPorts } from '../adapters/createCanvasWritePreparationPorts';
import type { CanvasCliScope, CanvasCliServices } from './definitions/canvasCliExecution';

export async function executeCanvasCliWrite(
  command: Extract<CanvasCliCommand, { kind: 'apply' | 'arrange' }>,
  scope: CanvasCliScope,
  services: CanvasCliServices
) {
  const operations =
    command.kind === 'arrange'
      ? CanvasCliBatchSchema.parse([{ op: 'arrange', ...command.options }])
      : CanvasCliBatchSchema.parse(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await readCanvasInputFile(scope.conversationRoot, command.file, scope.context.signal)
            )
          )
        );
  const payloadIdentity = JsonValueSchema.parse({
    kind: 'canvas-cli',
    version: CANVAS_CLI_VERSION,
    operations,
  });
  const document = services.runtimeFor(scope.database);
  const replay = document.editing.replayAgentRequest({
    documentId: scope.documentId,
    requestId: command.requestId,
    actor: scope.actor,
    payloadIdentity,
  });
  // 诊断属于本次计算窗口；正式提交回执在重试时逐字段复用，绝不重算布局。
  if (replay)
    return {
      ...projectCanvasAgentReceipt(replay),
      diagnostics: [],
      computation: null,
      replayed: true,
    };
  const snapshot = document.read(scope.documentId, scope.projectId);
  const preparation = createCanvasWritePreparationPorts({
    ...scope,
    snapshot,
    requestId: command.requestId,
    dryRun: command.dryRun,
    references: services.referencesFor(scope.database),
    capabilities: services.capabilities,
  });
  const prepared = await prepareCanvasWrite(
    { snapshot, operations, dryRun: command.dryRun, signal: scope.context.signal },
    preparation.ports
  );
  let request = CanvasCommitRequestSchema.parse({
    documentId: scope.documentId,
    requestId: command.requestId,
    operations: prepared.operations,
    referenceBindings: preparation.readBindings(),
    payloadIdentity,
  });
  let diagnostics: readonly CanvasLayoutDiagnostic[] = [];
  let computation: CanvasLayoutComputation | null = null;
  if (prepared.arrange) {
    const layout = await prepareCanvasCliArrangement({
      request,
      arrangement: prepared.arrange,
      scope,
      services,
      document,
    });
    request = layout.request;
    diagnostics = layout.diagnostics;
    computation = layout.computation;
  }
  scope.context.signal.throwIfAborted();
  document.assertDocument(scope.documentId, scope.projectId);
  services.referencesFor(scope.database).assertBindings({
    sourceDocumentId: scope.documentId,
    bindings: request.referenceBindings ?? [],
  });
  if (command.dryRun) {
    const preview = document.editing.preview({ request, actor: scope.actor, now: Date.now() });
    const after = preview.state.elements.map(row => row.element);
    return {
      status: 'dry-run',
      tentative: true,
      sequence: preview.state.sequence,
      refs: preview.refs,
      results: preview.results,
      diagnostics: [...diagnostics, ...findCanvasSectionOverlaps(snapshot.elements, after)],
      computation,
      replayed: false,
      planned: projectCanvasPlannedElements(after, new Set(preview.changes.map(c => c.id))),
      note: '没有写入。ID/位置仅为预测，正式提交仍按最新占用计算；使用本批临时ref连接新卡。',
    };
  }
  const result = document.editing.commitAgent({
    request,
    actor: scope.actor,
    now: Date.now(),
    intent: prepared.arrange ? 'arrange' : 'apply',
    payloadIdentity,
  });
  // 分区长大压到邻区时提醒 Agent 只整理分区；提交本身不自动推开。
  const overlaps =
    result.kind === 'committed'
      ? findCanvasSectionOverlaps(
          snapshot.elements,
          document.read(scope.documentId, scope.projectId).elements
        )
      : [];
  return {
    ...projectCanvasAgentReceipt(result),
    diagnostics: [...diagnostics, ...overlaps],
    computation,
    replayed: false,
  };
}
/** dry-run 只回本批改动到的元素：卡给出预测的位置与大小，连线只给身份。 */
function projectCanvasPlannedElements(
  elements: readonly import('../../shared').CanvasElement[],
  changed: ReadonlySet<string>
) {
  return elements
    .filter(element => changed.has(element.id))
    .map(element =>
      element.type === 'edge'
        ? { id: element.id, type: element.type }
        : {
            id: element.id,
            type: element.type,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
          }
    );
}
function projectCanvasAgentReceipt(result: import('../../shared').CanvasAgentCommitResult) {
  if (result.kind === 'committed')
    return {
      status: 'committed',
      requestId: result.commit.requestId,
      sequence: result.commit.sequence,
      refs: result.commit.refs,
      results: result.commit.results,
    };
  return {
    status: 'pending',
    requestId: result.approval.requestId,
    reason: result.approval.reason,
    operationCount: result.approval.operationCount,
    elementIds: result.approval.elementIds,
    message:
      '本批尚未执行，等待用户在画布中点允许或不允许。请在回复中提醒用户，不能用CLI代替批准。',
  };
}
