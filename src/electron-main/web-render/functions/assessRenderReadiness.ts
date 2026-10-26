import { isLikelyWebAppShell } from '../../../tools/web/webread/functions/isLikelyWebAppShell';

/** 连续多少次采样可见正文长度不变才算稳定。 */
export const RENDER_READINESS_STABLE_SAMPLES = 2;
/** xhr/fetch 全部结束后需持续安静的时长；避免请求间隙被误当作“数据已到齐”。 */
export const RENDER_DATA_QUIET_MS = 1_000;

export interface RenderReadinessSample {
  readonly readyState: string;
  /** body.innerText 长度，只计可见文字，不含内联脚本。 */
  readonly textLength: number;
  readonly scriptCount: number;
}

export interface RenderReadinessFacts {
  readonly sample: RenderReadinessSample;
  readonly stableSamples: number;
  readonly dataRequestsInFlight: number;
  /** 本次任务已观察到至少一个 xhr/fetch。 */
  readonly sawDataRequest: boolean;
  /** 最近一次数据请求结束（或导航开始）以来的安静时长；有请求在途时为 0。 */
  readonly dataQuietMs: number;
  readonly sinceDomReadyMs: number;
  readonly maxSettleDelayMs: number;
  readonly deadlineReached: boolean;
}

export type RenderReadinessDecision = 'wait' | 'ready' | 'app_shell_not_rendered';

/**
 * 从 DOM 就绪起判断何时提取页面。load 事件不再是前提；空白稳定只对没有应用壳迹象的页面算就绪。
 * 应用壳要等正文出现：数据请求都结束仍为空壳，或在既有预算内仍未渲染，报告未渲染。
 */
export function assessRenderReadiness(facts: RenderReadinessFacts): RenderReadinessDecision {
  const stable = facts.stableSamples >= RENDER_READINESS_STABLE_SAMPLES;
  const complete = facts.sample.readyState === 'complete';
  const dataQuiet = facts.dataRequestsInFlight === 0 && facts.dataQuietMs >= RENDER_DATA_QUIET_MS;
  const appShell = isLikelyWebAppShell({
    visibleTextLength: facts.sample.textLength,
    scriptCount: facts.sample.scriptCount,
  });

  if (appShell) {
    if (facts.deadlineReached) return 'app_shell_not_rendered';
    // 应用尚未发出任何数据请求时可能仍在启动，不能用“安静”推断已经渲染完。
    const settledBlank = stable && complete && facts.sawDataRequest && dataQuiet;
    return settledBlank ? 'app_shell_not_rendered' : 'wait';
  }

  if (facts.deadlineReached) return 'ready';
  if (!stable) return 'wait';
  if (facts.sinceDomReadyMs >= facts.maxSettleDelayMs) return 'ready';
  // 正文稳定但仍有数据请求在途时，在设定窗口内继续等待它们补全正文。
  if (facts.dataRequestsInFlight > 0) return 'wait';
  return complete || dataQuiet ? 'ready' : 'wait';
}
