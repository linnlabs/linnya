import {
  CanvasCommitRequestSchema,
  CanvasCommitResultSchema,
  type CanvasCommitResult,
} from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type {
  CanvasCommitActor,
  CanvasCommitContext,
  CanvasCommitParticipant,
  CanvasCommitPlan,
  CanvasCommitState,
  CanvasEditingClaim,
  CanvasCommitPublication,
} from '../definitions/canvasCommit';
import { validateCanvasPlanContent } from '../functions/validateCanvasContent';
import { planCanvasCommit } from '../functions/planCanvasCommit';
import type { CanvasRectangle } from '../../../../shared/geometry/definitions/canvasGeometry';
import {
  canvasPayloadHash,
  canvasSourceKey,
  canvasOperationsPayload,
} from '../functions/canvasRequestIdentity';
import {
  persistCanvasCommit,
  readCanvasCommitState,
  readCanvasEditingClaims,
} from '../persistence/canvasRepository';
import { readCanvasReceipt } from '../persistence/readCanvasRequestReceipts';
import { pruneCanvasRequestReceipts } from '../persistence/canvasRequestRepository';
import { performance } from 'node:perf_hooks';

export interface CanvasHistoryCommitInput {
  readonly context: CanvasCommitContext;
  readonly before: CanvasCommitState;
  readonly plan: CanvasCommitPlan;
  readonly result: CanvasCommitResult;
  readonly operations?: readonly import('../../../../shared').CanvasCommand[];
}
export interface CanvasCommitPorts {
  readonly reservedRectangles?: (
    state: CanvasCommitState,
    context: CanvasCommitContext
  ) => readonly CanvasRectangle[];
  readonly participants?: readonly CanvasCommitParticipant[];
  readonly publish?: (
    plan: CanvasCommitPlan,
    context: CanvasCommitContext,
    publication: CanvasCommitPublication
  ) => void;
  readonly publicationFailed?: (error: unknown) => void;
  /** 事务内持久化组事实，返回的纯内存更新仅在事务成功后调用。 */
  readonly history?: (input: CanvasHistoryCommitInput) => (() => void) | undefined;
}
export interface CanvasTransitionInput {
  readonly database: CanvasDatabase;
  readonly documentId: string;
  readonly requestId: string;
  readonly payload: unknown;
  readonly actor: CanvasCommitActor;
  readonly now: number;
  readonly referenceBindings?: readonly import('@app/schemas').DocumentReferenceMarkdownBinding[];
  readonly operations?: readonly import('../../../../shared').CanvasCommand[];
  readonly ports?: CanvasCommitPorts;
  readonly buildPlan: (
    state: CanvasCommitState,
    claims: readonly CanvasEditingClaim[],
    origin: string
  ) => CanvasCommitPlan;
}

/** 人工、Agent、恢复与撤回共享事务/回执/通知合同，只有纯计划来源不同。 */
export function commitCanvasTransition(input: CanvasTransitionInput): CanvasCommitResult {
  const sourceKey = canvasSourceKey(input.actor);
  const payloadHash = canvasPayloadHash(input.payload);
  const context: CanvasCommitContext = {
    documentId: input.documentId,
    requestId: input.requestId,
    actor: input.actor,
    now: input.now,
    referenceBindings: input.referenceBindings,
  };
  let result: CanvasCommitResult | undefined;
  let committedPlan: CanvasCommitPlan | undefined;
  let updateMemory: (() => void) | undefined;
  input.database
    .transaction(() => {
      const receipt = readCanvasReceipt(input.database, {
        documentId: input.documentId,
        requestId: input.requestId,
        sourceKey,
      });
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new Error('request_id_payload_mismatch');
        result = receipt.result;
        return;
      }
      const state = readCanvasCommitState(input.database, input.documentId);
      const claims = readCanvasEditingClaims(input.database, {
        documentId: input.documentId,
        viewId: input.actor.viewId,
        now: input.now,
      });
      const plan = input.buildPlan(state, claims, `${sourceKey}:${input.requestId}`);
      validateCanvasPlanContent(plan);
      result = {
        documentId: input.documentId,
        requestId: input.requestId,
        sequence: plan.state.sequence,
        results: plan.results,
        refs: plan.refs,
      };
      persistCanvasCommit(input.database, {
        documentId: input.documentId,
        sourceKey,
        source: input.actor.source,
        plan,
        result,
        payloadHash,
        now: input.now,
      });
      for (const participant of input.ports?.participants ?? []) participant.commit(plan, context);
      updateMemory = input.ports?.history?.({
        context,
        before: state,
        plan,
        result,
        operations: input.operations,
      });
      pruneCanvasRequestReceipts(input.database, input.documentId);
      committedPlan = plan;
    })
    .immediate();
  const committedAt = performance.timeOrigin + performance.now();
  updateMemory?.();
  if (committedPlan && committedPlan.changes.length > 0 && input.ports?.publish) {
    try {
      input.ports.publish(committedPlan, context, { committedAt });
    } catch (error) {
      input.ports.publicationFailed?.(error);
    }
  }
  return CanvasCommitResultSchema.parse(result);
}

/** 异步正文转换、排版和图片准备必须在进入此函数前完成。 */
export function commitCanvasOperations(input: {
  readonly database: CanvasDatabase;
  readonly request: unknown;
  readonly actor: CanvasCommitActor;
  readonly now: number;
  readonly ports?: CanvasCommitPorts;
}): CanvasCommitResult {
  const request = CanvasCommitRequestSchema.parse(input.request);
  return commitCanvasTransition({
    ...input,
    documentId: request.documentId,
    requestId: request.requestId,
    referenceBindings: request.referenceBindings,
    operations: request.operations,
    payload: canvasOperationsPayload(request),
    buildPlan: (state, claims, origin) =>
      planCanvasCommit({
        state,
        operations: request.operations,
        actor: input.actor,
        claims,
        now: input.now,
        origin,
        layoutGroups: request.layoutGroups,
        reservedRectangles: input.ports?.reservedRectangles?.(state, {
          documentId: request.documentId,
          requestId: request.requestId,
          actor: input.actor,
          now: input.now,
        }),
      }),
  });
}
