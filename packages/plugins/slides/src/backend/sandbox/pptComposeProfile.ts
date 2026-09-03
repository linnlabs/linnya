import { CHART_PRESET_NAMES } from './chartPresets';
import { LAYOUT_PRIMITIVES_SOURCE } from './layoutPrimitives';
import {
  instrumentDeckSourceForLayoutTrace,
  LAYOUT_TRACE_RUNTIME_SOURCE,
  readLayoutTrace,
  type LayoutTraceSnapshot,
} from './layoutTrace';
import { isSandboxJsonObject, measureJsonBytes } from './sandboxJson';
import type {
  ResourceLimits,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxJsonObject,
  SandboxJsonValue,
  SandboxPolicy,
  SandboxPreparedExecution,
  SandboxProfile,
} from '@plugin/backend/sandboxRuntime';
import { isFlexComposeInput } from '@plugin/slides/shared';

// ─── Profile 返回值：codegen-source compose 模式 ────────────────────────

/** create 模式（compose 调用） */
export interface PptComposeCreateValue extends SandboxJsonObject {
  mode: 'create';
  composeInput: SandboxJsonObject;
  composeCallCount: number;
  layoutTrace: LayoutTraceSnapshot;
}

export type PptComposeSandboxValue = PptComposeCreateValue;

const DEFAULT_LIMITS: Required<ResourceLimits> = {
  timeoutMs: 10_000,
  maxLogLines: 200,
  maxLogLineLength: 2000,
  maxResultBytes: 256 * 1024,
  maxSourceBytes: 128 * 1024,
  maxCapabilityPayloadBytes: 256 * 1024,
  maxHeapMb: 128,
  idleTimeoutMs: 12_000,
};

const PROFILE_ID = 'ppt_compose';
const POLICY_VERSION = 'v1';
const ALLOWED_CAPABILITIES = new Set([
  'host.compose',
  'host.log',
  'host.metric',
  'host.timer',
]);

export const pptComposeProfile: SandboxProfile<PptComposeSandboxValue> = {
  id: PROFILE_ID,
  policyVersion: POLICY_VERSION,
  allowedCapabilities: ALLOWED_CAPABILITIES,

  buildPolicy(request: SandboxExecutionRequest): SandboxPolicy {
    return {
      profileId: PROFILE_ID,
      policyVersion: POLICY_VERSION,
      limits: {
        timeoutMs: request.limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
        maxLogLines: request.limits?.maxLogLines ?? DEFAULT_LIMITS.maxLogLines,
        maxLogLineLength: request.limits?.maxLogLineLength ?? DEFAULT_LIMITS.maxLogLineLength,
        maxResultBytes: request.limits?.maxResultBytes ?? DEFAULT_LIMITS.maxResultBytes,
        maxSourceBytes: request.limits?.maxSourceBytes ?? DEFAULT_LIMITS.maxSourceBytes,
        maxCapabilityPayloadBytes: request.limits?.maxCapabilityPayloadBytes ?? DEFAULT_LIMITS.maxCapabilityPayloadBytes,
        maxHeapMb: request.limits?.maxHeapMb ?? DEFAULT_LIMITS.maxHeapMb,
        idleTimeoutMs: request.limits?.idleTimeoutMs ?? DEFAULT_LIMITS.idleTimeoutMs,
      },
      capabilities: [
        ...(request.capabilities ?? [{ name: 'host.compose', maxBytes: DEFAULT_LIMITS.maxCapabilityPayloadBytes }]),
      ],
    };
  },

  prepareExecution(
    request: SandboxExecutionRequest,
    policy: SandboxPolicy,
    runId: string,
  ): SandboxPreparedExecution | SandboxExecutionResult<PptComposeSandboxValue> {
    const profileMode = request.profileMode ?? 'codegen-source';
    if (profileMode !== 'codegen-source') {
      return buildFailure(
        runId,
        policy,
        {
          type: 'policy_denied',
          message: 'ppt_compose 只支持 codegen-source 模式。请通过 write_file / edit_file 修改 deck.js source。',
        },
      );
    }

    const sourceBytes = measureJsonBytes(request.source);
    if (sourceBytes > policy.limits.maxSourceBytes) {
      return buildFailure(
        runId,
        policy,
        {
          type: 'resource_exhausted',
          message: `源码过大：${sourceBytes} bytes，超过上限 ${policy.limits.maxSourceBytes} bytes。`,
        },
      );
    }

    const inputs = request.inputs ?? {};
    const slideWidth = readFiniteNumber(inputs, 'SLIDE_W', 10);
    const slideHeight = readFiniteNumber(inputs, 'SLIDE_H', 5.625);
    const presets = readStringArray(inputs, 'CHART_PRESETS', CHART_PRESET_NAMES);
    // DECK_DESIGN 永远是对象（缺省 / 非法 → 空骨架），保证 sandbox 内 `DECK_DESIGN.palette.x` 不 NPE。
    const deckDesign = readDeckDesignSkeleton(inputs, 'DECK_DESIGN');

    // 根据 capabilities 动态挂载沙箱全局函数
    const bindings: Array<{ kind: 'capability'; globalName: string; capability: string }> = [];
    if (policy.capabilities.some((c) => c.name === 'host.compose')) {
      bindings.push({ kind: 'capability', globalName: 'compose', capability: 'host.compose' });
    }

    // 在用户代码前注入场景图 DSL 工厂函数（含独立 SVG Graphic；文字仍使用 createText）
    // 为不可用的 API 注入引导性错误 stub，避免 AI 得到无意义的 "xxx is not defined"
    const hasCompose = policy.capabilities.some((c) => c.name === 'host.compose');
    const stubs = [
      !hasCompose && buildUnavailableStub('compose', 'host.compose 在 codegen-source 模式下未授予。'),
      buildUnavailableStub(
        'editPresentation',
        'host.editPresentation 在 codegen-source 模式下不可用。请使用 read_file / edit_file 修改 deck.js 源码后重跑 compose()。',
      ),
    ].filter(Boolean).join('\n');

    const executableSource = instrumentDeckSourceForLayoutTrace(request.source) + '\nreturn __buildLayoutTrace();';
    const augmentedSource = [
      LAYOUT_TRACE_RUNTIME_SOURCE,
      LAYOUT_PRIMITIVES_SOURCE,
      stubs,
      executableSource,
    ].join('\n');

    return {
      runnerRequest: {
        runId,
        profileId: policy.profileId,
        language: request.language,
        source: augmentedSource,
        globals: {
          SLIDE_W: slideWidth,
          SLIDE_H: slideHeight,
          CHART_PRESETS: presets,
          DECK_DESIGN: deckDesign,
        },
        bindings,
        limits: policy.limits,
        capabilities: policy.capabilities,
        telemetry: request.telemetry,
      },
    };
  },

  finalizeExecution(
    _request: SandboxExecutionRequest,
    policy: SandboxPolicy,
    runId: string,
    runnerResult,
  ): SandboxExecutionResult<PptComposeSandboxValue> {
    if (!runnerResult.success) {
      return {
        success: false,
        logs: runnerResult.logs,
        error: runnerResult.error,
        usage: buildUsage(runnerResult),
        telemetry: {
          runId,
          profileId: policy.profileId,
          policyVersion: policy.policyVersion,
          limits: policy.limits,
          diagnostics: runnerResult.diagnostics,
        },
        artifacts: [],
      };
    }

    const composeCalls = runnerResult.capabilityCalls.filter((call) => call.name === 'host.compose');

    if (composeCalls.length === 0) {
      return buildFailure(runId, policy, {
        type: 'runtime',
        message: '代码执行成功，但未调用 compose()。请用 compose({ title, slides: [...] }) 提交 deck.js 结果。',
      }, runnerResult);
    }

    return finalizeCreateMode(composeCalls, runnerResult, runId, policy);
  },
};

function buildUnavailableStub(functionName: string, message: string): string {
  return `function ${functionName}() { throw new Error(${JSON.stringify(message)}); }`;
}

// ─── create 模式 finalize ──────────────────────────────────────────────

function finalizeCreateMode(
  composeCalls: Array<{ name: string; payload?: SandboxJsonValue }>,
  runnerResult: RunnerResultLike,
  runId: string,
  policy: SandboxPolicy,
): SandboxExecutionResult<PptComposeSandboxValue> {
  if (composeCalls.length > 1) {
    return buildFailure(runId, policy, {
      type: 'policy_denied',
      message: `compose() 被调用了 ${composeCalls.length} 次，只允许调用一次。`,
    }, runnerResult);
  }

  const composePayload = composeCalls[0].payload;
  if (!composePayload || typeof composePayload !== 'object' || Array.isArray(composePayload)) {
    return buildFailure(runId, policy, {
      type: 'runtime',
      message: 'compose() 的参数必须是一个对象，如 compose({ title, slides: [...] })。',
    }, runnerResult);
  }

  // 仅接受场景图 DSL 格式（slides 包含 _type: 'Slide' 节点），由 CodegenDeckBuilder 通过 FlexLayoutCompiler 编译。
  if (!isFlexComposeInput(composePayload)) {
    return buildFailure(runId, policy, {
      type: 'runtime',
      message: 'compose() 输入必须使用场景图 DSL 格式（createSlide/createFrame/createText 等工厂函数构建）。',
    }, runnerResult);
  }

  const layoutTrace = readLayoutTrace(runnerResult.value);
  if (!layoutTrace) {
    return buildFailure(runId, policy, {
      type: 'runtime',
      message: '代码执行成功，但未生成有效的布局追踪结果。',
    }, runnerResult);
  }

  return {
    success: true,
    value: {
      mode: 'create',
      composeInput: composePayload,
      composeCallCount: composeCalls.length,
      layoutTrace,
    },
    logs: runnerResult.logs,
    usage: buildUsage(runnerResult),
    telemetry: {
      runId,
      profileId: policy.profileId,
      policyVersion: policy.policyVersion,
      limits: policy.limits,
      diagnostics: runnerResult.diagnostics,
    },
    artifacts: [],
  };
}

/** 内部 runner result 类型别名，避免重复写完整签名 */
type RunnerResultLike = {
  success: boolean;
  elapsedMs: number;
  logs: string[];
  value?: SandboxJsonValue;
  error?: import('@plugin/backend/sandboxRuntime').SandboxError;
  capabilityCalls: Array<{ name: string; payload?: SandboxJsonValue }>;
  deniedActions: string[];
  diagnostics: import('@plugin/backend/sandboxRuntime').SandboxRunnerDiagnostics;
};

// ─── 公共读取函数 ──────────────────────────────────────────────────────

/**
 * 从 profile 产物中读取 create 模式的原始 compose payload。
 * 返回的 rawPayload 由 CodegenDeckBuilder 通过 FlexLayoutCompiler 编译为绝对坐标。
 */
export function readPptComposeRawPayload(value: SandboxJsonValue | undefined): {
  rawPayload: SandboxJsonObject;
  composeCallCount: number;
  layoutTrace: LayoutTraceSnapshot;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if ('mode' in value && value['mode'] !== 'create') return null;

  const composeInputRaw = value['composeInput'];
  const composeCallCountRaw = value['composeCallCount'];
  if (!composeInputRaw || typeof composeInputRaw !== 'object' || Array.isArray(composeInputRaw)) return null;
  if (typeof composeCallCountRaw !== 'number' || !Number.isFinite(composeCallCountRaw)) return null;
  const layoutTrace = readLayoutTrace(value['layoutTrace']);
  if (!layoutTrace) return null;

  return {
    rawPayload: composeInputRaw,
    composeCallCount: composeCallCountRaw,
    layoutTrace,
  };
}

function buildUsage(runnerResult: {
  elapsedMs: number;
  logs: string[];
  value?: SandboxJsonValue;
  capabilityCalls: Array<{ name: string }>;
  deniedActions: string[];
}) {
  const capabilityCallsByName: Record<string, number> = {};
  for (const call of runnerResult.capabilityCalls) {
    capabilityCallsByName[call.name] = (capabilityCallsByName[call.name] ?? 0) + 1;
  }

  return {
    elapsedMs: runnerResult.elapsedMs,
    logLines: runnerResult.logs.length,
    logBytes: measureJsonBytes(runnerResult.logs),
    resultBytes: measureJsonBytes(runnerResult.value),
    capabilityCallCount: runnerResult.capabilityCalls.length,
    capabilityCallsByName,
    deniedActions: [...runnerResult.deniedActions],
  };
}

function buildFailure(
  runId: string,
  policy: SandboxPolicy,
  error: { type: 'runtime' | 'policy_denied' | 'resource_exhausted'; message: string },
  runnerResult?: RunnerResultLike,
): SandboxExecutionResult<PptComposeSandboxValue> {
  return {
    success: false,
    logs: runnerResult?.logs ?? [],
    error,
    usage: buildUsage(
      runnerResult ?? {
        elapsedMs: 0,
        logs: [],
        capabilityCalls: [],
        deniedActions: [],
      },
    ),
    telemetry: {
      runId,
      profileId: policy.profileId,
      policyVersion: policy.policyVersion,
      limits: policy.limits,
      diagnostics: runnerResult?.diagnostics ?? {
        runnerKind: 'not-started',
        startConfirmed: false,
        heartbeatCount: 0,
        protocolEvents: [],
        stderrBytes: 0,
        idleTimeoutTriggered: false,
        cleanupStatus: 'succeeded',
      },
    },
    artifacts: [],
  };
}

function readFiniteNumber(inputs: SandboxJsonObject, key: string, fallback: number): number {
  const value = inputs[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStringArray(inputs: SandboxJsonObject, key: string, fallback: readonly string[]): string[] {
  const value = inputs[key];
  if (!Array.isArray(value)) return [...fallback];
  const out = value.filter((entry): entry is string => typeof entry === 'string');
  return out.length > 0 ? out : [...fallback];
}

/**
 * 读取 DECK_DESIGN 输入，**永远返回非 null 对象**：
 * - 入参缺失 / null / 非 plain object → 空骨架 `{ palette:{}, fonts:{} }`
 * - 入参为 plain object → 复用上层结构，再补齐缺失的 palette / fonts 子段
 *
 * 这样 sandbox 内 `DECK_DESIGN.palette.accent1` 永远不会 throw，
 * 即便上游忘传或类型异常，AI 也只会拿到 undefined（配合 `??` 兜底色即可）。
 */
function readDeckDesignSkeleton(inputs: SandboxJsonObject, key: string): SandboxJsonObject {
  const value = inputs[key];
  if (!isSandboxJsonObject(value)) {
    return { palette: {}, fonts: {} };
  }
  const palette = pickJsonObject(value.palette);
  const fonts = pickJsonObject(value.fonts);
  return { ...value, palette, fonts };
}

function pickJsonObject(value: unknown): SandboxJsonObject {
  if (isSandboxJsonObject(value)) {
    return value;
  }
  return {};
}
