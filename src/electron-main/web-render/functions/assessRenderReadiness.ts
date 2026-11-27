import { WEB_READ_SUBSTANTIAL_CONTENT_CHARS } from '../../../tools/web/webread/definitions/readLadder';
import { isLikelyWebAppShell } from '../../../tools/web/webread/functions/isLikelyWebAppShell';

/** 连续多少次采样可见正文长度不变才算稳定。 */
export const RENDER_READINESS_STABLE_SAMPLES = 2;
/** xhr/fetch 全部结束后需持续安静的时长；避免请求间隙被误当作“数据已到齐”。 */
export const RENDER_DATA_QUIET_MS = 1_000;
/** 主区达到实质长度后，高水位停止增长并持续静默的提取阈值（不再被后台轮询拖死）。 */
export const RENDER_MAIN_QUIET_MS = 700;
/** 视为“主区正在有效增长”的最小高水位增量；忽略倒计时跳动、轮播切换等微小抖动。 */
export const RENDER_MAIN_GROWTH_MIN_CHARS = 24;
/**
 * 脚本与样式表全部结束后需持续安静的时长。JSONP 和按需加载的脚本链不是 xhr/fetch，
 * 只看数据请求会在 load 之后、列表数据返回之前就判定就绪（公告列表页只读到页面框架）。
 */
export const RENDER_PAGE_LOAD_QUIET_MS = 500;

export interface RenderReadinessSample {
  readonly readyState: string;
  /** body.innerText 长度，只计可见文字，不含内联脚本。 */
  readonly textLength: number;
  /** 排除导航、侧栏、页脚、弹窗与固定遮罩后的主区可见文字长度；缺省时回退 textLength。 */
  readonly mainTextLength?: number;
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
  /** 主区可见字数高水位停止有效增长以来的静默时长。 */
  readonly mainQuietMs?: number;
  /** 在途的脚本与样式表请求数。 */
  readonly pageLoadRequestsInFlight: number;
  /** 最近一次脚本或样式表请求开始或结束以来的安静时长；有请求在途时为 0。 */
  readonly pageLoadQuietMs: number;
  readonly sinceDomReadyMs: number;
  readonly maxSettleDelayMs: number;
  readonly deadlineReached: boolean;
}

export type RenderReadinessDecision = 'wait' | 'ready' | 'app_shell_not_rendered';

export type RenderReadinessReason =
  | 'wait_app_shell'
  | 'wait_unstable'
  | 'wait_data_in_flight'
  | 'wait_page_load_in_flight'
  | 'wait_main_growing'
  | 'app_shell_deadline'
  | 'app_shell_settled_blank'
  | 'main_substantial_quiet'
  | 'max_settle_elapsed'
  | 'complete_or_data_quiet'
  | 'deadline';

export interface RenderReadinessAssessment {
  readonly decision: RenderReadinessDecision;
  readonly reason: RenderReadinessReason;
}

/**
 * 从 DOM 就绪起判断何时提取页面（主区感知就绪）：
 * 1. 只把主区可见字数计入实质内容与应用壳判断，导航/Cookie 文案不再遮蔽慢水合；
 * 2. 主区已达实质长度且高水位静默达到阈值时立即提取，不受后台轮询或数字跳动拖死；
 * 3. 主区尚未达到实质长度且仍在增长或数据请求在途时，在就绪总上限内继续等待。
 */
export function assessRenderReadinessDetailed(facts: RenderReadinessFacts): RenderReadinessAssessment {
  const effectiveMainLength = facts.sample.mainTextLength ?? facts.sample.textLength;
  const stable = facts.stableSamples >= RENDER_READINESS_STABLE_SAMPLES;
  const complete = facts.sample.readyState === 'complete';
  const dataQuiet = facts.dataRequestsInFlight === 0 && facts.dataQuietMs >= RENDER_DATA_QUIET_MS;
  const pageLoadQuiet = facts.pageLoadRequestsInFlight === 0 && facts.pageLoadQuietMs >= RENDER_PAGE_LOAD_QUIET_MS;
  const mainQuiet = facts.mainQuietMs !== undefined && facts.mainQuietMs >= RENDER_MAIN_QUIET_MS;
  const mainSubstantial = effectiveMainLength >= WEB_READ_SUBSTANTIAL_CONTENT_CHARS;
  const appShell = isLikelyWebAppShell({
    visibleTextLength: effectiveMainLength,
    scriptCount: facts.sample.scriptCount,
  });

  if (appShell) {
    if (facts.deadlineReached) {
      return { decision: 'app_shell_not_rendered', reason: 'app_shell_deadline' };
    }
    // 应用尚未发出任何数据请求时可能仍在启动，不能用“安静”推断已经渲染完。
    const settledBlank = stable && complete && facts.sawDataRequest && dataQuiet && pageLoadQuiet;
    return settledBlank
      ? { decision: 'app_shell_not_rendered', reason: 'app_shell_settled_blank' }
      : { decision: 'wait', reason: 'wait_app_shell' };
  }

  if (facts.deadlineReached) {
    return { decision: 'ready', reason: 'deadline' };
  }
  // 主区已经有实质正文并停止高水位增长：即使页面仍有轮询 XHR 或微小倒计时抖动，也及时提取。
  if (mainSubstantial && mainQuiet) {
    return { decision: 'ready', reason: 'main_substantial_quiet' };
  }
  if (!stable) {
    return { decision: 'wait', reason: 'wait_unstable' };
  }
  if (facts.sinceDomReadyMs >= facts.maxSettleDelayMs) {
    if (mainSubstantial || (facts.dataRequestsInFlight === 0 && (facts.mainQuietMs === undefined || mainQuiet))) {
      return { decision: 'ready', reason: 'max_settle_elapsed' };
    }
    return { decision: 'wait', reason: 'wait_main_growing' };
  }
  // 正文稳定但仍有数据请求在途时，在设定窗口内继续等待它们补全正文。
  if (facts.dataRequestsInFlight > 0) {
    return { decision: 'wait', reason: 'wait_data_in_flight' };
  }
  // 正文还没到实质长度、只是“看起来稳定”时，脚本仍在加载或刚加载完就再等一等；等待受上面的安定上限约束。
  if (!pageLoadQuiet) {
    return { decision: 'wait', reason: 'wait_page_load_in_flight' };
  }
  return complete || dataQuiet
    ? { decision: 'ready', reason: 'complete_or_data_quiet' }
    : { decision: 'wait', reason: 'wait_unstable' };
}

export function assessRenderReadiness(facts: RenderReadinessFacts): RenderReadinessDecision {
  return assessRenderReadinessDetailed(facts).decision;
}
