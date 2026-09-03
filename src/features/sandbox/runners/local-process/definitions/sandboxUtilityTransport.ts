import path from 'node:path';

import { z } from 'zod';

import type {
  SandboxControlFrameKind,
  SandboxControlProtocolSnapshot,
} from './sandboxControlProtocol.js';
import { parseSandboxRunToken } from './sandboxMailboxProtocol.js';
import { parseSandboxHeapLimitMb } from './sandboxRuntimeLimits.js';

export const SANDBOX_UTILITY_ACK_DEADLINE_MS = 2_000;
export const SANDBOX_UTILITY_MAX_PENDING_ACKNOWLEDGEMENTS = 64;
const SandboxUtilityGenerationSchema = z.string().uuid();
export type SandboxUtilityGeneration = z.infer<typeof SandboxUtilityGenerationSchema>;

export type SandboxUtilityTerminationCause =
  | 'natural'
  | 'cancelled'
  | 'timed_out'
  | 'idle_timed_out'
  | 'owner_ended'
  | 'transport_failed';

export type SandboxUtilitySettlementFailure =
  | 'launch_failed'
  | 'root_exit_failed'
  | 'root_close_failed'
  | 'control_stream_failed'
  | 'stderr_stream_failed'
  | 'tree_cleanup_failed'
  | 'tree_empty_failed'
  | 'resource_release_failed'
  | 'result_mailbox_failed';

export interface SandboxEvaluatorLaunch {
  readonly executablePath: string;
  readonly entryPath: string;
  readonly environment: Readonly<Record<string, string>>;
}

export type SandboxUtilityHostPayload =
  | {
      readonly kind: 'sandbox_start';
      readonly runToken: string;
      readonly runDirectory: string;
      readonly timeoutMs: number;
      readonly idleTimeoutMs: number;
      readonly maximumHeapMb: number;
      readonly evaluator: SandboxEvaluatorLaunch;
    }
  | {
      readonly kind: 'sandbox_cancel';
      readonly runToken: string;
    }
  | { readonly kind: 'sandbox_owner_end' };

export type SandboxUtilityChildPayload =
  | { readonly kind: 'sandbox_utility_ready'; readonly utilityPid: number }
  | {
      readonly kind: 'sandbox_evaluator_frame';
      readonly runToken: string;
      readonly frame: SandboxControlFrameKind;
      readonly evaluatorPid: number;
    }
  | {
      readonly kind: 'sandbox_terminal';
      readonly runToken: string;
      readonly cause: SandboxUtilityTerminationCause;
      readonly rootExit?: {
        readonly exitCode: number | null;
        readonly signal: string | null;
      };
      readonly control: SandboxControlProtocolSnapshot;
      readonly stderrBytes: number;
      readonly stderrTail: string;
      readonly settlementFailures: readonly SandboxUtilitySettlementFailure[];
    };

export interface SandboxUtilityMessageEnvelope {
  readonly kind: 'sandbox_utility_message';
  readonly generation: SandboxUtilityGeneration;
  readonly messageId: number;
  readonly payload: unknown;
}

export interface SandboxUtilityAcknowledgementEnvelope {
  readonly kind: 'sandbox_utility_ack';
  readonly generation: SandboxUtilityGeneration;
  readonly messageId: number;
}

export type SandboxUtilityEnvelope =
  | SandboxUtilityMessageEnvelope
  | SandboxUtilityAcknowledgementEnvelope;

export function parseSandboxUtilityGeneration(value: unknown): SandboxUtilityGeneration {
  const parsed = SandboxUtilityGenerationSchema.safeParse(value);
  if (!parsed.success) throw new Error('sandbox utility generation is invalid');
  return parsed.data;
}

export function parseSandboxUtilityEnvelope(value: unknown): SandboxUtilityEnvelope {
  if (!isRecord(value)) throw new Error('sandbox utility envelope must be an object');
  const kind = Reflect.get(value, 'kind');
  const generation = parseSandboxUtilityGeneration(Reflect.get(value, 'generation'));
  const messageId = parseNonNegativeSafeInteger(Reflect.get(value, 'messageId'));
  if (kind === 'sandbox_utility_ack') {
    requireExactKeys(value, ['kind', 'generation', 'messageId']);
    return { kind, generation, messageId };
  }
  if (kind !== 'sandbox_utility_message') {
    throw new Error('sandbox utility envelope kind is invalid');
  }
  requireExactKeys(value, ['kind', 'generation', 'messageId', 'payload']);
  return { kind, generation, messageId, payload: Reflect.get(value, 'payload') };
}

export function parseSandboxUtilityHostPayload(value: unknown): SandboxUtilityHostPayload {
  if (!isRecord(value)) throw new Error('sandbox utility host payload must be an object');
  const kind = Reflect.get(value, 'kind');
  if (kind === 'sandbox_owner_end') {
    requireExactKeys(value, ['kind']);
    return { kind };
  }
  const runToken = parseSandboxRunToken(Reflect.get(value, 'runToken'));
  if (kind === 'sandbox_cancel') {
    requireExactKeys(value, ['kind', 'runToken']);
    return { kind, runToken };
  }
  if (kind !== 'sandbox_start') throw new Error('sandbox utility host payload kind is invalid');
  requireExactKeys(value, [
    'kind',
    'runToken',
    'runDirectory',
    'timeoutMs',
    'idleTimeoutMs',
    'maximumHeapMb',
    'evaluator',
  ]);
  const runDirectory = requireAbsolutePath(Reflect.get(value, 'runDirectory'), 'runDirectory');
  const evaluator = parseEvaluatorLaunch(Reflect.get(value, 'evaluator'));
  return {
    kind,
    runToken,
    runDirectory,
    timeoutMs: parsePositiveSafeInteger(Reflect.get(value, 'timeoutMs')),
    idleTimeoutMs: parsePositiveSafeInteger(Reflect.get(value, 'idleTimeoutMs')),
    maximumHeapMb: parseSandboxHeapLimitMb(Reflect.get(value, 'maximumHeapMb')),
    evaluator,
  };
}

export function parseSandboxUtilityChildPayload(value: unknown): SandboxUtilityChildPayload {
  if (!isRecord(value)) throw new Error('sandbox utility child payload must be an object');
  const kind = Reflect.get(value, 'kind');
  if (kind === 'sandbox_utility_ready') {
    requireExactKeys(value, ['kind', 'utilityPid']);
    return { kind, utilityPid: parsePositiveSafeInteger(Reflect.get(value, 'utilityPid')) };
  }
  const runToken = parseSandboxRunToken(Reflect.get(value, 'runToken'));
  if (kind === 'sandbox_evaluator_frame') {
    requireExactKeys(value, ['kind', 'runToken', 'frame', 'evaluatorPid']);
    const frame = Reflect.get(value, 'frame');
    if (frame !== 'ready' && frame !== 'started' && frame !== 'result_committed') {
      throw new Error('sandbox evaluator frame kind is invalid');
    }
    return {
      kind,
      runToken,
      frame,
      evaluatorPid: parsePositiveSafeInteger(Reflect.get(value, 'evaluatorPid')),
    };
  }
  if (kind !== 'sandbox_terminal') throw new Error('sandbox utility child payload kind is invalid');
  requireExactKeys(value, [
    'kind',
    'runToken',
    'cause',
    'rootExit',
    'control',
    'stderrBytes',
    'stderrTail',
    'settlementFailures',
  ], ['rootExit']);
  return {
    kind,
    runToken,
    cause: parseTerminationCause(Reflect.get(value, 'cause')),
    ...parseOptionalRootExit(Reflect.get(value, 'rootExit')),
    control: parseControlSnapshot(Reflect.get(value, 'control')),
    stderrBytes: parseNonNegativeSafeInteger(Reflect.get(value, 'stderrBytes')),
    stderrTail: requireString(Reflect.get(value, 'stderrTail'), 'stderrTail'),
    settlementFailures: parseSettlementFailures(Reflect.get(value, 'settlementFailures')),
  };
}

function parseEvaluatorLaunch(value: unknown): SandboxEvaluatorLaunch {
  if (!isRecord(value)) throw new Error('sandbox evaluator launch must be an object');
  requireExactKeys(value, ['executablePath', 'entryPath', 'environment']);
  const environment = Reflect.get(value, 'environment');
  if (!isRecord(environment)) throw new Error('sandbox evaluator environment is invalid');
  const parsedEnvironment: Record<string, string> = {};
  for (const [key, entry] of Object.entries(environment)) {
    if (key.length === 0 || typeof entry !== 'string') {
      throw new Error('sandbox evaluator environment entry is invalid');
    }
    parsedEnvironment[key] = entry;
  }
  return {
    executablePath: requireAbsolutePath(Reflect.get(value, 'executablePath'), 'executablePath'),
    entryPath: requireAbsolutePath(Reflect.get(value, 'entryPath'), 'entryPath'),
    environment: Object.freeze(parsedEnvironment),
  };
}

function parseOptionalRootExit(value: unknown): { readonly rootExit?: { readonly exitCode: number | null; readonly signal: string | null } } {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('sandbox utility root exit is invalid');
  requireExactKeys(value, ['exitCode', 'signal']);
  const exitCode = Reflect.get(value, 'exitCode');
  const signal = Reflect.get(value, 'signal');
  const hasExitCode = typeof exitCode === 'number'
    && Number.isSafeInteger(exitCode)
    && exitCode >= 0;
  const hasSignal = typeof signal === 'string' && signal.length > 0;
  // Node 的 exit 合同只会给出 exit code 或 signal 之一；拒绝模糊终态，避免 owner
  // 把同一次退出同时解释成自然完成和外部终止。
  if (hasExitCode === hasSignal
    || (exitCode !== null && !hasExitCode)
    || (signal !== null && !hasSignal)) {
    throw new Error('sandbox utility root exit fields are invalid');
  }
  return { rootExit: { exitCode, signal } };
}

function parseControlSnapshot(value: unknown): SandboxControlProtocolSnapshot {
  if (!isRecord(value)) throw new Error('sandbox control snapshot is invalid');
  requireExactKeys(value, [
    'acceptedFrames',
    'evaluatorPid',
    'windowsCrLfPreambleObserved',
    'completed',
  ], ['evaluatorPid']);
  const acceptedFrames = Reflect.get(value, 'acceptedFrames');
  if (!Array.isArray(acceptedFrames)
    || !acceptedFrames.every(frame => frame === 'ready' || frame === 'started' || frame === 'result_committed')) {
    throw new Error('sandbox control snapshot frames are invalid');
  }
  const evaluatorPid = Reflect.get(value, 'evaluatorPid');
  const windowsCrLfPreambleObserved = Reflect.get(value, 'windowsCrLfPreambleObserved');
  const completed = Reflect.get(value, 'completed');
  if ((evaluatorPid !== undefined && !isPositiveSafeInteger(evaluatorPid))
    || typeof windowsCrLfPreambleObserved !== 'boolean'
    || typeof completed !== 'boolean') {
    throw new Error('sandbox control snapshot fields are invalid');
  }
  const validPrefixes: readonly (readonly SandboxControlFrameKind[])[] = [
    [],
    ['ready'],
    ['ready', 'started'],
    ['ready', 'started', 'result_committed'],
  ];
  const isValidPrefix = validPrefixes.some(prefix => (
    prefix.length === acceptedFrames.length
    && prefix.every((frame, index) => frame === acceptedFrames[index])
  ));
  const hasEvaluatorPid = evaluatorPid !== undefined;
  const shouldBeCompleted = acceptedFrames.length === 3;
  if (!isValidPrefix
    || hasEvaluatorPid !== (acceptedFrames.length > 0)
    || completed !== shouldBeCompleted) {
    throw new Error('sandbox control snapshot state is inconsistent');
  }
  return {
    acceptedFrames: Object.freeze([...acceptedFrames]),
    ...(evaluatorPid === undefined ? {} : { evaluatorPid }),
    windowsCrLfPreambleObserved,
    completed,
  };
}

function parseTerminationCause(value: unknown): SandboxUtilityTerminationCause {
  if (value === 'natural'
    || value === 'cancelled'
    || value === 'timed_out'
    || value === 'idle_timed_out'
    || value === 'owner_ended'
    || value === 'transport_failed') return value;
  throw new Error('sandbox utility termination cause is invalid');
}

function parseSettlementFailures(value: unknown): readonly SandboxUtilitySettlementFailure[] {
  if (!Array.isArray(value) || !value.every(isSettlementFailure)) {
    throw new Error('sandbox utility settlement failures are invalid');
  }
  if (new Set(value).size !== value.length) {
    throw new Error('sandbox utility settlement failures contain duplicates');
  }
  return Object.freeze([...value]);
}

function isSettlementFailure(value: unknown): value is SandboxUtilitySettlementFailure {
  return value === 'launch_failed'
    || value === 'root_exit_failed'
    || value === 'root_close_failed'
    || value === 'control_stream_failed'
    || value === 'stderr_stream_failed'
    || value === 'tree_cleanup_failed'
    || value === 'tree_empty_failed'
    || value === 'resource_release_failed'
    || value === 'result_mailbox_failed';
}

function requireExactKeys(
  value: object,
  expected: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  const allowed = new Set(expected);
  if (keys.some(key => !allowed.has(key))
    || expected.some(key => !optional.includes(key) && !keys.includes(key))) {
    throw new Error('sandbox utility object contains invalid fields');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`sandbox utility ${field} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const parsed = requireString(value, field);
  if (parsed.length === 0) throw new Error(`sandbox utility ${field} must not be empty`);
  return parsed;
}

function parsePositiveSafeInteger(value: unknown): number {
  if (!isPositiveSafeInteger(value)) throw new Error('sandbox utility value must be a positive safe integer');
  return value;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function requireAbsolutePath(value: unknown, field: string): string {
  const parsed = requireNonEmptyString(value, field);
  if (!path.isAbsolute(parsed)) throw new Error(`sandbox utility ${field} must be absolute`);
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('sandbox utility value must be a non-negative safe integer');
  }
  return value;
}
