import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { CanvasCardIdSchema, type CanvasCommitResult } from '@plugin/canvas/shared';
import {
  CanvasT13CommitRowSchema, CanvasT13FitSchema, CanvasT13FrameWindowSchema,
  CanvasT13ReadinessSchema, type CanvasT13BridgeExchange, type CanvasT13Observation,
} from '../definitions/canvasT13Metrics';

const statsSchema = z.object({ presentation: z.object({ sceneTransitions: z.number().int().nonnegative(), renders: z.number().int().nonnegative() }),
  commits: z.object({ rows: z.array(CanvasT13CommitRowSchema) }) });
export class CanvasT13EvidenceError extends Error {}
function requireEvidence(value: boolean, reason: string): asserts value {
  if (!value) throw new CanvasT13EvidenceError(reason);
}
function sameIds(a: readonly string[], b: readonly string[]) {
  return new Set(a).size === a.length && new Set(b).size === b.length
    && isDeepStrictEqual([...a].sort(), [...b].sort());
}

/** 同一正式提交、真实scope修订、typed bridge请求/响应和实际draw必须闭合；派生delta不能自证。 */
export function admitCanvasT13Observation(input: {
  readonly observation: CanvasT13Observation; readonly commit: CanvasCommitResult;
  readonly originalIds: ReadonlySet<string>; readonly exchanges: readonly CanvasT13BridgeExchange[];
  readonly startedAt: number; readonly finishedAt: number;
}) {
  const { observation: observation, commit, exchanges } = input;
  const { row, receipt, fit, frameWindow, targets, samples, natural } = observation;
  requireEvidence(observation.status === 'geometry-observed' && !!receipt && !!fit
    && !!frameWindow && !!targets && !!samples?.length && !!natural, 'observation_incomplete');
  const scope = row.scope, event = row.event;
  requireEvidence(!!scope && event.documentId === commit.documentId && event.sourceKind === 'agent'
    && event.sequence === commit.sequence && scope.sequence === commit.sequence
    && observation.sequence === commit.sequence && receipt.sequence === commit.sequence, 'commit_scope_mismatch');
  const committedAt = event.committedAt;
  requireEvidence(committedAt !== undefined && committedAt >= input.startedAt && committedAt <= input.finishedAt,
    'commit_time_unattributed');
  const appliedIds = [...new Set(commit.results.flatMap(result => result.status === 'applied'
    && CanvasCardIdSchema.safeParse(result.id).success && result.id ? [result.id] : []))];
  requireEvidence(sameIds(appliedIds, [...scope.cards.map(card => card.id), ...scope.deletedCardIds]), 'commit_card_ids_mismatch');
  const expected = scope.cards.filter(card => !input.originalIds.has(card.id));
  requireEvidence(expected.length > 0 && isDeepStrictEqual(targets, expected), 'target_revision_scope_mismatch');
  const last = samples[samples.length - 1];
  requireEvidence(!!last && last.presentation.sceneTransitions === 0 && last.readiness.documentId === commit.documentId
    && last.readiness.sequence >= commit.sequence && last.readiness.environment.visibilityState === 'visible'
    && !last.readiness.readiness.suspended && !last.readiness.readiness.precisionSettling, 'draw_not_visible_or_current');
  const cards = last.readiness.readiness.cards;
  requireEvidence(sameIds(cards.map(card => card.id), expected.map(card => card.id))
    && cards.every(card => card.mode !== 'outside' && card.revision === expected.find(target => target.id === card.id)?.revision),
    'draw_card_revision_mismatch');
  requireEvidence(receipt.observedAt === last.readiness.observedAt && receipt.receivedAt === last.receivedAt
    && receipt.renders === last.readiness.renders && receipt.receivedAt >= receipt.observedAt
    && receipt.observedAt >= committedAt, 'draw_receipt_mismatch');
  const fits = exchanges.filter(exchange => exchange.command.kind === 'fit'
    && exchange.requestedAt >= committedAt && exchange.receivedAt <= receipt.receivedAt);
  requireEvidence(fits.length === 1 && isDeepStrictEqual(CanvasT13FitSchema.parse(fits[0].value), fit), 'one_fit_proof_missing');
  const naturalProof = exchanges.some(exchange => {
    if (exchange.command.kind !== 'readiness' || exchange.receivedAt > fits[0].requestedAt
      || !sameIds(exchange.command.payload.elementIds, expected.map(card => card.id))) return false;
    const parsed = CanvasT13ReadinessSchema.safeParse(exchange.value);
    return parsed.success && isDeepStrictEqual(parsed.data, natural) && parsed.data.documentId === commit.documentId;
  });
  requireEvidence(naturalProof, 'natural_viewport_proof_missing');
  const readiness = exchanges.filter(exchange => {
    if (exchange.command.kind !== 'readiness' || exchange.receivedAt !== last.receivedAt
      || !sameIds(exchange.command.payload.elementIds, expected.map(card => card.id))) return false;
    const parsed = CanvasT13ReadinessSchema.safeParse(exchange.value);
    return parsed.success && isDeepStrictEqual(parsed.data, last.readiness);
  });
  requireEvidence(readiness.length === 1, 'raw_readiness_proof_missing');
  const zeroStats = exchanges.flatMap(exchange => {
    if (exchange.command.kind !== 'stats' || exchange.requestedAt < fits[0].receivedAt
      || exchange.receivedAt > readiness[0].requestedAt) return [];
    const parsed = statsSchema.safeParse(exchange.value);
    return parsed.success && parsed.data.presentation.sceneTransitions === 0
      && parsed.data.commits.rows.some(value => isDeepStrictEqual(value, row))
      ? [{ exchange, value: parsed.data }] : [];
  }).sort((a, b) => a.exchange.receivedAt - b.exchange.receivedAt);
  // readiness与其后stats之间也可能实际draw；非零动画必须以真实zero-stats当时的renders作基线。
  const zero = fit.sceneTransitions === 0 ? fit.renders : zeroStats[0]?.value.presentation.renders;
  requireEvidence(zero !== undefined && receipt.zeroBaseline === zero && receipt.renders > zero, 'post_zero_actual_draw_missing');
  const stats = exchanges.filter(exchange => {
    if (exchange.command.kind !== 'stats' || exchange.requestedAt < last.receivedAt) return false;
    const parsed = statsSchema.safeParse(exchange.value);
    return parsed.success && parsed.data.presentation.sceneTransitions === 0 && parsed.data.presentation.renders >= receipt.renders
      && parsed.data.commits.rows.some(value => isDeepStrictEqual(value, row));
  });
  requireEvidence(stats.length > 0, 'raw_commit_scope_proof_missing');
  const windows = exchanges.filter(exchange => {
    if (exchange.command.kind !== 'frame-window' || exchange.requestedAt < receipt.receivedAt
      || exchange.command.payload.since !== committedAt || exchange.command.payload.until !== receipt.observedAt) return false;
    const parsed = CanvasT13FrameWindowSchema.safeParse(exchange.value);
    return parsed.success && isDeepStrictEqual(parsed.data, frameWindow);
  });
  requireEvidence(windows.length === 1 && frameWindow.documentId === commit.documentId, 'raw_frame_window_proof_missing');
  const frames = frameWindow.frames;
  requireEvidence(frames.retentionComplete && frames.visibility === 'visible' && frames.focused && frames.since === committedAt
    && frames.until === receipt.observedAt && frames.since >= frames.retainedSince && frames.until <= frames.capturedThrough,
    'frame_window_incomplete');
  requireEvidence(frames.samples.length > 0 && frames.samples.every(sample => sample.at > frames.since
    && sample.at - sample.interval < frames.until), 'frame_samples_missing_or_outside_window');
  const firstFrame = frames.samples[0], lastFrame = frames.samples[frames.samples.length - 1];
  // 独立复核实际边界，不能只信上游填入的retentionComplete或capturedThrough。
  requireEvidence(!!firstFrame && !!lastFrame && firstFrame.at - firstFrame.interval <= frames.since
    && lastFrame.at >= frames.until, 'frame_window_boundaries_missing');
  return { sequence: commit.sequence, requestId: commit.requestId, committedAt,
    observedAt: receipt.observedAt, receivedAt: receipt.receivedAt,
    commitToFrameUpperBoundMs: receipt.receivedAt - committedAt, targets, cards,
    actualChangedCardCount: scope.cards.length, bodyReadyIds: cards.filter(card => card.mode === 'body' && card.status === 'ready').map(card => card.id),
    natural, fit, frameWindow, zeroBaselineBasis: fit.sceneTransitions === 0 ? 'synchronous-fit' : 'zero-stats-response',
    zeroBaselineRenders: zero, evidenceFiles: [...fits, ...readiness, ...stats, ...windows, ...zeroStats.map(value => value.exchange)]
      .flatMap(exchange => [exchange.requestFile, exchange.responseFile]) };
}
