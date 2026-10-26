import { describe, expect, it } from 'vitest';
import {
  RENDER_DATA_QUIET_MS,
  assessRenderReadiness,
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
});
