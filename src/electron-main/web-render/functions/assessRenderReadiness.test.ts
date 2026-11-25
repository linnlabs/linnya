import { describe, expect, it } from 'vitest';
import {
  RENDER_DATA_QUIET_MS,
  RENDER_MAIN_QUIET_MS,
  assessRenderReadiness,
  assessRenderReadinessDetailed,
  type RenderReadinessFacts,
} from './assessRenderReadiness';

const APP_SHELL = { readyState: 'complete', textLength: 12, scriptCount: 4 };
const ARTICLE = { readyState: 'complete', textLength: 2_000, scriptCount: 4 };

function facts(overrides: Partial<RenderReadinessFacts>): RenderReadinessFacts {
  return {
    sample: ARTICLE,
    stableSamples: 2,
    dataRequestsInFlight: 0,
    sawDataRequest: false,
    dataQuietMs: RENDER_DATA_QUIET_MS,
    sinceDomReadyMs: 500,
    maxSettleDelayMs: 3_000,
    deadlineReached: false,
    ...overrides,
  };
}

describe('渲染就绪判断', () => {
  it('正文稳定且页面完成时就绪；未稳定时继续等待', () => {
    expect(assessRenderReadiness(facts({}))).toBe('ready');
    expect(assessRenderReadiness(facts({ stableSamples: 1 }))).toBe('wait');
  });

  it('load 未完成时，正文稳定且数据请求安静即可提取，不再等待 load 事件', () => {
    const interactive = { ...ARTICLE, readyState: 'interactive' };
    expect(assessRenderReadiness(facts({ sample: interactive }))).toBe('ready');
    expect(assessRenderReadiness(facts({ sample: interactive, dataQuietMs: RENDER_DATA_QUIET_MS - 1 })))
      .toBe('wait');
    expect(assessRenderReadiness(facts({ sample: interactive, sinceDomReadyMs: 3_000, dataQuietMs: 0 })))
      .toBe('ready');
  });

  it('正文已稳定但仍有数据请求在途时，在 settle 窗口内继续等待补全', () => {
    expect(assessRenderReadiness(facts({ dataRequestsInFlight: 1, dataQuietMs: 0 }))).toBe('wait');
    expect(assessRenderReadiness(facts({ dataRequestsInFlight: 1, dataQuietMs: 0, sinceDomReadyMs: 3_000 })))
      .toBe('ready');
  });

  it('没有应用壳迹象的空白页沿用快速路径，交给 Web 抽取判定空正文', () => {
    expect(assessRenderReadiness(facts({ sample: { readyState: 'complete', textLength: 0, scriptCount: 0 } })))
      .toBe('ready');
  });

  it('空白应用壳稳定不算就绪：应用尚未发出数据请求时继续等待', () => {
    expect(assessRenderReadiness(facts({ sample: APP_SHELL }))).toBe('wait');
    expect(assessRenderReadiness(facts({ sample: APP_SHELL, sawDataRequest: true, dataRequestsInFlight: 1, dataQuietMs: 0 })))
      .toBe('wait');
  });

  it('数据请求全部结束并安静后仍为空壳，或预算耗尽仍为空壳，报告未渲染', () => {
    expect(assessRenderReadiness(facts({ sample: APP_SHELL, sawDataRequest: true }))).toBe('app_shell_not_rendered');
    expect(assessRenderReadiness(facts({ sample: APP_SHELL, sawDataRequest: true, dataQuietMs: RENDER_DATA_QUIET_MS - 1 })))
      .toBe('wait');
    expect(assessRenderReadiness(facts({ sample: APP_SHELL, deadlineReached: true, dataRequestsInFlight: 2 })))
      .toBe('app_shell_not_rendered');
  });

  it('预算耗尽时普通页面按现有 DOM 提取，不因未稳定而失败', () => {
    expect(assessRenderReadiness(facts({ stableSamples: 0, dataRequestsInFlight: 3, deadlineReached: true })))
      .toBe('ready');
  });

  it('主区感知：导航与弹窗文字 >300 字而主区仍为空时，必须继续等待慢水合', () => {
    const navOnly = { readyState: 'complete', textLength: 420, mainTextLength: 0, scriptCount: 4 };
    expect(assessRenderReadinessDetailed(facts({
      sample: navOnly,
      sawDataRequest: false,
      sinceDomReadyMs: 3_500,
    }))).toEqual({ decision: 'wait', reason: 'wait_app_shell' });
  });

  it('主区达到实质长度且高水位静默后，即使轮询 XHR 在途且整页总字数微小抖动，也及时就绪', () => {
    const pollingPage = { readyState: 'interactive', textLength: 1_210, mainTextLength: 1_000, scriptCount: 5 };
    expect(assessRenderReadinessDetailed(facts({
      sample: pollingPage,
      stableSamples: 0,
      dataRequestsInFlight: 1,
      dataQuietMs: 0,
      mainQuietMs: RENDER_MAIN_QUIET_MS,
      sinceDomReadyMs: 900,
    }))).toEqual({ decision: 'ready', reason: 'main_substantial_quiet' });
  });

  it('主区未达实质长度且仍在等待数据或增长时，maxSettleDelayMs 到达后仍续期到总就绪上限', () => {
    const growing = { readyState: 'complete', textLength: 400, mainTextLength: 320, scriptCount: 4 };
    expect(assessRenderReadinessDetailed(facts({
      sample: growing,
      stableSamples: 2,
      dataRequestsInFlight: 1,
      dataQuietMs: 0,
      mainQuietMs: 200,
      sinceDomReadyMs: 3_000,
      maxSettleDelayMs: 3_000,
      deadlineReached: false,
    }))).toEqual({ decision: 'wait', reason: 'wait_main_growing' });
  });
});
