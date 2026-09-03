import type {
  ParsedPendingRevision,
  PendingRevisionOperation,
} from './pendingRevisionTypes'
import { shouldLogRevisionDebug } from '../revisionDebugLogging'
import { sampleEditorMemory } from '../../../../ui/services/editorMemoryPerf'

export type NonInsertBatchMode = 'parallel' | 'serial'

export type PreparedRevisionStageKey =
  | 'yieldMs'
  | 'blockLookupMs'
  | 'hydrationMs'
  | 'resolveMs'
  | 'previewConversionMs'
  | 'linearizeMs'
  | 'planMs'

export type AppliedRevisionStageKey = 'locateMs' | 'convertMs' | 'executeMs'

export interface PreparedRevisionPerf {
  id: string
  blockId?: string
  operation: Exclude<PendingRevisionOperation, 'insert'>
  markdownLength: number
  totalMs: number
  yieldMs: number
  blockLookupMs: number
  hydrationMs: number
  resolveMs: number
  previewConversionMs: number
  linearizeMs: number
  planMs: number
  resolutionKind?: string
  resolutionSource?: string
  planKind?: string
  skipped?: boolean
  errorStage?: string
  errorMessage?: string
}

export interface AppliedRevisionPerf {
  id: string
  blockId: string
  operation: Exclude<PendingRevisionOperation, 'insert'>
  planKind: string
  totalMs: number
  locateMs: number
  convertMs: number
  executeMs: number
  success: boolean
  errorStage?: string
  errorMessage?: string
}

export interface NonInsertBatchPerfReport {
  id: number
  mode: NonInsertBatchMode
  requestedCount: number
  preparedCount: number
  projectedCount: number
  skippedCount: number
  failedCount: number
  totalMs: number
  prepareTotalMs: number
  applyTotalMs: number
  dispatchMs: number
  registerMs: number
  repeatedTargetFallback: boolean
  docChanged: boolean
  fatalError?: string
  stages: {
    yieldMs: number
    blockLookupMs: number
    hydrationMs: number
    resolveMs: number
    previewConversionMs: number
    linearizeMs: number
    planMs: number
    locateMs: number
    convertMs: number
    executeMs: number
  }
  slowestPrepare: PreparedRevisionPerf[]
  slowestApply: AppliedRevisionPerf[]
  errors: Array<{
    id: string
    blockId?: string
    stage: string
    message: string
  }>
  timestamp: number
}

export interface NonInsertBatchPerfReportInput {
  mode: NonInsertBatchMode
  requestedCount: number
  prepared: PreparedRevisionPerf[]
  applied: AppliedRevisionPerf[]
  totalMs: number
  prepareTotalMs: number
  applyTotalMs: number
  dispatchMs: number
  registerMs: number
  repeatedTargetFallback: boolean
  docChanged: boolean
  fatalError?: unknown
}

export interface RevisionBatchPerfApi {
  getLast: () => NonInsertBatchPerfReport | null
  getHistory: () => NonInsertBatchPerfReport[]
  clear: () => void
}

declare global {
  interface Window {
    __REVISION_BATCH_PERF__?: RevisionBatchPerfApi
  }
}

const SLOW_BATCH_LOG_THRESHOLD_MS = 500
const HISTORY_LIMIT = 20
const SAMPLE_LIMIT = 3
const ERROR_LIMIT = 8

let reportSeq = 0
const history: NonInsertBatchPerfReport[] = []

export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

export function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function createPreparedRevisionPerf(
  parsed: ParsedPendingRevision,
  operation: Exclude<PendingRevisionOperation, 'insert'>
): PreparedRevisionPerf {
  return {
    id: parsed.id,
    blockId: parsed.blockId,
    operation,
    markdownLength: typeof parsed.newMarkdown === 'string' ? parsed.newMarkdown.length : 0,
    totalMs: 0,
    yieldMs: 0,
    blockLookupMs: 0,
    hydrationMs: 0,
    resolveMs: 0,
    previewConversionMs: 0,
    linearizeMs: 0,
    planMs: 0,
  }
}

export function createAppliedRevisionPerf(params: {
  id: string
  blockId: string
  operation: Exclude<PendingRevisionOperation, 'insert'>
  planKind: string
}): AppliedRevisionPerf {
  return {
    ...params,
    totalMs: 0,
    locateMs: 0,
    convertMs: 0,
    executeMs: 0,
    success: false,
  }
}

export async function measurePreparedStage<T>(
  perf: PreparedRevisionPerf,
  stage: PreparedRevisionStageKey,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = nowMs()
  try {
    return await run()
  } catch (error) {
    markPreparedError(perf, stage, error)
    throw error
  } finally {
    perf[stage] = roundMs(perf[stage] + nowMs() - startedAt)
  }
}

export function measurePreparedStageSync<T>(
  perf: PreparedRevisionPerf,
  stage: PreparedRevisionStageKey,
  run: () => T
): T {
  const startedAt = nowMs()
  try {
    return run()
  } catch (error) {
    markPreparedError(perf, stage, error)
    throw error
  } finally {
    perf[stage] = roundMs(perf[stage] + nowMs() - startedAt)
  }
}

export function measureAppliedStage<T>(
  perf: AppliedRevisionPerf,
  stage: AppliedRevisionStageKey,
  run: () => T
): T {
  const startedAt = nowMs()
  try {
    return run()
  } catch (error) {
    markAppliedError(perf, stage, error)
    throw error
  } finally {
    perf[stage] = roundMs(perf[stage] + nowMs() - startedAt)
  }
}

export function markPreparedError(
  perf: PreparedRevisionPerf,
  stage: string,
  error: unknown
): void {
  perf.errorStage = perf.errorStage ?? stage
  perf.errorMessage = perf.errorMessage ?? formatErrorMessage(error)
}

export function markAppliedError(
  perf: AppliedRevisionPerf,
  stage: string,
  error: unknown
): void {
  perf.errorStage = perf.errorStage ?? stage
  perf.errorMessage = perf.errorMessage ?? formatErrorMessage(error)
}

function sum<T>(items: readonly T[], select: (item: T) => number): number {
  return roundMs(items.reduce((total, item) => total + select(item), 0))
}

function pickSlowest<T extends { totalMs: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.totalMs - a.totalMs).slice(0, SAMPLE_LIMIT)
}

function collectErrors(
  prepared: readonly PreparedRevisionPerf[],
  applied: readonly AppliedRevisionPerf[],
  fatalError: unknown | undefined
): NonInsertBatchPerfReport['errors'] {
  const errors: NonInsertBatchPerfReport['errors'] = []
  for (const item of prepared) {
    if (!item.errorMessage) continue
    errors.push({
      id: item.id,
      blockId: item.blockId,
      stage: item.errorStage ?? 'prepare',
      message: item.errorMessage,
    })
  }
  for (const item of applied) {
    if (!item.errorMessage) continue
    errors.push({
      id: item.id,
      blockId: item.blockId,
      stage: item.errorStage ?? 'apply',
      message: item.errorMessage,
    })
  }
  if (fatalError != null) {
    errors.push({
      id: 'batch',
      stage: 'fatal',
      message: formatErrorMessage(fatalError),
    })
  }
  return errors.slice(0, ERROR_LIMIT)
}

export function buildNonInsertBatchPerfReport(
  input: NonInsertBatchPerfReportInput
): NonInsertBatchPerfReport {
  const failedCount = input.prepared.filter((item) => item.errorMessage).length
    + input.applied.filter((item) => item.errorMessage).length
    + (input.fatalError == null ? 0 : 1)

  return {
    id: ++reportSeq,
    mode: input.mode,
    requestedCount: input.requestedCount,
    preparedCount: input.prepared.filter((item) => !item.skipped && !item.errorMessage).length,
    projectedCount: input.applied.filter((item) => item.success).length,
    skippedCount: input.prepared.filter((item) => item.skipped).length,
    failedCount,
    totalMs: roundMs(input.totalMs),
    prepareTotalMs: roundMs(input.prepareTotalMs),
    applyTotalMs: roundMs(input.applyTotalMs),
    dispatchMs: roundMs(input.dispatchMs),
    registerMs: roundMs(input.registerMs),
    repeatedTargetFallback: input.repeatedTargetFallback,
    docChanged: input.docChanged,
    fatalError: input.fatalError == null ? undefined : formatErrorMessage(input.fatalError),
    stages: {
      yieldMs: sum(input.prepared, (item) => item.yieldMs),
      blockLookupMs: sum(input.prepared, (item) => item.blockLookupMs),
      hydrationMs: sum(input.prepared, (item) => item.hydrationMs),
      resolveMs: sum(input.prepared, (item) => item.resolveMs),
      previewConversionMs: sum(input.prepared, (item) => item.previewConversionMs),
      linearizeMs: sum(input.prepared, (item) => item.linearizeMs),
      planMs: sum(input.prepared, (item) => item.planMs),
      locateMs: sum(input.applied, (item) => item.locateMs),
      convertMs: sum(input.applied, (item) => item.convertMs),
      executeMs: sum(input.applied, (item) => item.executeMs),
    },
    slowestPrepare: pickSlowest(input.prepared),
    slowestApply: pickSlowest(input.applied),
    errors: collectErrors(input.prepared, input.applied, input.fatalError),
    timestamp: Date.now(),
  }
}

export function publishNonInsertBatchPerfReport(report: NonInsertBatchPerfReport): void {
  history.push(report)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  sampleEditorMemory('revision-pending-batch')

  if (typeof window !== 'undefined') {
    window.__REVISION_BATCH_PERF__ = {
      getLast: () => history[history.length - 1] ?? null,
      getHistory: () => [...history],
      clear: () => {
        history.length = 0
      },
    }
  }

  if (
    shouldLogRevisionDebug()
    || report.totalMs >= SLOW_BATCH_LOG_THRESHOLD_MS
    || report.failedCount > 0
  ) {
    console.info('[RevisionPerf] non-insert pending batch', report)
  }
}
