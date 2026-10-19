/**
 * 流式正文“匀速吐字”的节奏器（纯函数式状态，不依赖 DOM / Vue / 真实时钟）。
 *
 * 它不创造文字，只决定已经收到的文字在界面上以什么节奏放出：
 * - 放字速度 = max(近一个窗口内的到达速度 × 跟随系数, 为赶上每批文字的截止时间所需的速度, 最低速度)
 *   · 来源慢：放字跟着到达速度走，缓冲始终很浅，不会“快速吐完再停住”；
 *   · 来源突发：每批文字的截止时间 = 到达时刻 + 落后上限，按截止时间倒推所需速度，
 *     因此任何一个字出现在界面上都不会晚于到达后“落后上限 + 一帧”（硬上限）；
 *   · 来源断流：没有新字就没有新字，不预测、不补字。
 * - 所有长度都是 UTF-16 下标；是否落在码点边界由调用方用 `clampToCodePointBoundary` 处理。
 */

export interface StreamRevealPacerConfig {
  /** 任何一个字出现在界面上，最晚比它到达时刻晚多少秒（再加一帧）。 */
  readonly lagCapSeconds: number;
  /** 统计到达速度的滑动窗口（毫秒）。 */
  readonly arrivalWindowMs: number;
  /** 放字速度相对到达速度的跟随系数，略大于 1 才能把缓冲慢慢放空。 */
  readonly followFactor: number;
  /** 最低放字速度（字/秒），避免零星几个字拖很久。 */
  readonly minRate: number;
}

export const DEFAULT_STREAM_REVEAL_PACER_CONFIG: StreamRevealPacerConfig = {
  lagCapSeconds: 0.25,
  arrivalWindowMs: 800,
  followFactor: 1.15,
  minRate: 12,
};

/** 单次推进允许的最大时间间隔（毫秒）：标签页被挂起后回来，不会一帧放出巨量文字。 */
const MAX_ADVANCE_DT_MS = 100;
/** 截止时间已到或将到时，按一帧内放完计算，避免除以零。 */
const MIN_REMAINING_MS = 16;

export interface StreamRevealPacer {
  /** 已放出的长度。 */
  readonly shown: number;
  /** 已收到的长度。 */
  readonly received: number;
  /** 以 total 作为当前已收到的总长度；变短视为被替换，直接重置。 */
  receive(total: number, nowMs: number): void;
  /** 推进到 nowMs，返回已放出的长度。 */
  advance(nowMs: number): number;
  /** 立即放出全部已收到的内容。 */
  flush(): number;
  /** 以 total 为新的起点，已放出 = 已收到 = total。 */
  reset(total: number, nowMs: number): void;
}

export function createStreamRevealPacer(
  config: StreamRevealPacerConfig = DEFAULT_STREAM_REVEAL_PACER_CONFIG,
): StreamRevealPacer {
  let shown = 0;
  let received = 0;
  let carry = 0;
  let lastAdvanceMs: number | null = null;
  let arrivals: Array<{ readonly at: number; readonly chars: number }> = [];
  /** 尚未完全放出的批次：到达时刻与该批结束下标。 */
  let pending: Array<{ readonly at: number; readonly end: number }> = [];

  const arrivalRate = (nowMs: number): number => {
    arrivals = arrivals.filter(item => nowMs - item.at <= config.arrivalWindowMs);
    const chars = arrivals.reduce((sum, item) => sum + item.chars, 0);
    return chars / (config.arrivalWindowMs / 1000);
  };

  /** 为让每一批都在截止时间前放完所需的最小速度（字/秒）。 */
  const deadlineRate = (nowMs: number): number => {
    let needed = 0;
    for (const batch of pending) {
      const remainingMs = Math.max(batch.at + config.lagCapSeconds * 1000 - nowMs, MIN_REMAINING_MS);
      needed = Math.max(needed, ((batch.end - shown) / remainingMs) * 1000);
    }
    return needed;
  };

  return {
    get shown() {
      return shown;
    },
    get received() {
      return received;
    },
    receive(total, nowMs) {
      if (total < received) {
        this.reset(total, nowMs);
        return;
      }
      if (total === received) return;
      arrivals.push({ at: nowMs, chars: total - received });
      pending.push({ at: nowMs, end: total });
      received = total;
    },
    advance(nowMs) {
      const previous = lastAdvanceMs ?? nowMs;
      lastAdvanceMs = nowMs;
      const backlog = received - shown;
      if (backlog <= 0) {
        carry = 0;
        return shown;
      }
      const dtSeconds = Math.min(Math.max(nowMs - previous, 0), MAX_ADVANCE_DT_MS) / 1000;
      const rate = Math.max(arrivalRate(nowMs) * config.followFactor, deadlineRate(nowMs), config.minRate);
      carry += rate * dtSeconds;
      const step = Math.min(backlog, Math.floor(carry));
      if (step > 0) {
        carry -= step;
        shown += step;
        pending = pending.filter(batch => batch.end > shown);
      }
      return shown;
    },
    flush() {
      shown = received;
      carry = 0;
      pending = [];
      return shown;
    },
    reset(total, nowMs) {
      shown = total;
      received = total;
      carry = 0;
      arrivals = [];
      pending = [];
      lastAdvanceMs = nowMs;
    },
  };
}

/** 把下标退到码点边界，避免把代理对（emoji 等）切成两半。 */
export function clampToCodePointBoundary(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const previous = text.charCodeAt(index - 1);
  const isHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
  return isHighSurrogate ? index - 1 : index;
}
