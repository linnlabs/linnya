import { describe, expect, it } from 'vitest';
import { resolveConversationMessage } from './resolveConversationMessage';

describe('resolveConversationMessage', () => {
  it('uses the domain fallback for known conversation keys', () => {
    const result = resolveConversationMessage(
      'conversation.view.empty.title',
      (_key, fallback) => fallback,
    );

    expect(result).toBe('开启新对话');
  });

  it('passes params to the raw resolver', () => {
    const result = resolveConversationMessage(
      'conversation.sidebar.deleteSuccess',
      (_key, fallback, params) => fallback.replace('{title}', String(params?.title)),
      { title: 'Demo' },
    );

    expect(result).toBe('已删除对话：Demo');
  });

  it('resolves workspace reference notification fallbacks', () => {
    expect(resolveConversationMessage(
      'conversation.tool.workspace.reference.noContextDocument',
      (_key, fallback) => fallback,
    )).toBe('未找到可用于解析引用的上下文文档');

    expect(resolveConversationMessage(
      'conversation.tool.workspace.reference.ambiguous',
      (_key, fallback) => fallback,
    )).toBe('该引用在多个文档中都能匹配：请使用 [#ref@documentId] 指明目标文档');
  });

  it('resolves citation node accessibility label fallback', () => {
    expect(resolveConversationMessage(
      'conversation.citation.ariaLabel',
      (_key, fallback) => fallback,
    )).toBe('引用');
  });

  it('resolves thought status fallbacks', () => {
    expect(resolveConversationMessage(
      'conversation.thought.running',
      (_key, fallback) => fallback,
    )).toBe('正在思考');

    expect(resolveConversationMessage(
      'conversation.thought.completed',
      (_key, fallback, params) => fallback.replace('{duration}', String(params?.duration)),
      { duration: '3秒' },
    )).toBe('已思考3秒');
  });

  it('resolves save-as-document failure fallback', () => {
    expect(resolveConversationMessage(
      'conversation.turn.saveAsDocument.failed',
      (_key, fallback) => fallback,
    )).toBe('另存为文档失败');

    expect(resolveConversationMessage(
      'conversation.turn.saveAsDocument.defaultTitle',
      (_key, fallback, params) => fallback
        .replace('{date}', String(params?.date))
        .replace('{time}', String(params?.time)),
      { date: '2026-06-22', time: '1635' },
    )).toBe('Deep Research 报告 - 2026-06-22 1635');

    expect(resolveConversationMessage(
      'conversation.turn.export.renderedHtmlMissing',
      (_key, fallback) => fallback,
    )).toBe('无法提取渲染 HTML');
  });

  it('resolves conversation flow error fallbacks', () => {
    expect(resolveConversationMessage(
      'conversation.flow.missingProjectForSend',
      (_key, fallback) => fallback,
    )).toBe('当前版本会话必须依附项目：缺少 projectId，已中止发送。');

    expect(resolveConversationMessage(
      'conversation.flow.deepResearch.weeklyLimitReached',
      (_key, fallback, params) => fallback
        .replace('{usedCount}', String(params?.usedCount))
        .replace('{limit}', String(params?.limit))
        .replace('{resetText}', String(params?.resetText)),
      { usedCount: 3, limit: 3, resetText: '下周一 00:00' },
    )).toBe('本周 Deep Research 已达上限（3/3）。\n恢复时间：下周一 00:00');

    expect(resolveConversationMessage(
      'conversation.flow.pluginRun.agentChoiceUnavailable',
      (_key, fallback, params) => fallback.replace('{agentChoiceId}', String(params?.agentChoiceId)),
      { agentChoiceId: 'deep-research' },
    )).toBe('当前会话 Agent 未注册或未启用: deep-research');

    expect(resolveConversationMessage(
      'conversation.flow.pluginRun.executionFailed',
      (_key, fallback, params) => fallback.replace('{message}', String(params?.message)),
      { message: 'network error' },
    )).toBe('AI 运行失败，请稍后重试。');

    expect(resolveConversationMessage(
      'conversation.flow.conversationExecutionFailed',
      (_key, fallback) => fallback,
    )).toBe('Conversation 执行失败');

    expect(resolveConversationMessage(
      'conversation.flow.agentExecutionFailed',
      (_key, fallback) => fallback,
    )).toBe('Agent 执行失败');

  });

  it('resolves web tool config title fallbacks', () => {
    expect(resolveConversationMessage(
      'conversation.tool.webSearch.configTitleWithQuery',
      (_key, fallback, params) => fallback.replace('{query}', String(params?.query)),
      { query: 'Linnya' },
    )).toBe('联网搜索："Linnya"');

    expect(resolveConversationMessage(
      'conversation.tool.webRead.configTitleWithTarget',
      (_key, fallback, params) => fallback.replace('{target}', String(params?.target)),
      { target: 'https://example.com' },
    )).toBe('读取网页：https://example.com');
  });

});
