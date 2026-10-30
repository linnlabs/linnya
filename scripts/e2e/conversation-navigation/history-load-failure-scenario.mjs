import assert from 'node:assert/strict';

export async function runHistoryLoadFailureScenario(options) {
  const { cdp, evaluate, waitFor, clickConversation, rendererErrors, assertRendererHealthy, openNodeDatabase } = options;
  await clickConversation(cdp, 'E2E 对话 A');

  // 经正式 API 保存一条旧版本会写入的 load notice，验证历史事实保留但不再误报。
  await evaluate(cdp, `(async () => {
    const { sendClientNotice } = await import(
      '/apps/renderer/domains/conversation/features/client-notices/orchestration/clientNoticeApi.ts'
    );
    await sendClientNotice('e2e-conversation-b', {
      notice_id: '3bc05782-a8f4-400b-8a87-ded268962652',
      observed_at: Date.now(), operation: 'load', error_kind: 'unknown',
    });
  })()`);

  const interceptionErrors = [];
  const removeListener = cdp.onEvent(event => {
    if (event.method !== 'Fetch.requestPaused') return;
    void cdp.send('Fetch.failRequest', {
      requestId: event.params.requestId, errorReason: 'ConnectionReset',
    }).catch(error => interceptionErrors.push(error));
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/v1/conversation/e2e-conversation-b/ui-messages/tail*', requestStage: 'Request' }],
  });
  try {
    await evaluate(cdp, `(() => {
      const row = Array.from(document.querySelectorAll('.chat-list-item'))
        .find(element => element.querySelector('.chat-list-title')?.textContent?.trim() === 'E2E 对话 B');
      if (!(row instanceof HTMLElement)) throw new Error('Missing conversation B');
      row.click();
    })()`);
    await waitFor(() => evaluate(cdp, `document.querySelector('.message-window-error')?.textContent
      ?.includes('加载对话失败，连接异常，请检查连接。') === true`), '真实断连显示当前加载错误');
    const failureState = await evaluate(cdp, `(async () => {
      const { useClientNoticeStore } = await import(
        '/apps/renderer/domains/conversation/features/client-notices/store/clientNoticeStore.ts'
      );
      return {
        noticeCount: document.querySelectorAll('.client-notice').length,
        currentErrorCount: document.querySelectorAll('.message-window-error').length,
        outboxCount: useClientNoticeStore().entries.length,
        stage: window.__CONVERSATION_PERF__?.getHistory('history-load')
          .findLast(sample => sample.phase === 'window-error')?.details?.stage,
      };
    })()`);
    assert.deepEqual(failureState, { noticeCount: 0, currentErrorCount: 1, outboxCount: 0, stage: 'request' });
  } finally {
    await cdp.send('Fetch.disable');
    removeListener();
  }
  assert.deepEqual(interceptionErrors, []);
  // 只有这次主动注入断连产生的 HistoryLoader 日志是预期结果，其他 Renderer 异常仍使测试失败。
  const expectedErrors = rendererErrors.splice(0);
  assert.equal(expectedErrors.length, 1);
  assert.match(expectedErrors[0], /\[HistoryLoader\] Failed to load conversation history window:.*Conversation window request failed/s);

  await clickConversation(cdp, 'E2E 对话 A');
  await clickConversation(cdp, 'E2E 对话 B');
  const recoveredState = await evaluate(cdp, `(async () => {
    const { useMessageWindowStore } = await import(
      '/apps/renderer/domains/conversation/message-window/store/messageWindowStore.ts'
    );
    const store = useMessageWindowStore();
    return {
      status: store.status, error: store.error,
      currentErrorCount: document.querySelectorAll('.message-window-error').length,
      noticeCount: document.querySelectorAll('.client-notice').length,
      retainedLegacyCount: store.rows.filter(row => row.message.type === 'client_notice'
        && row.message.metadata.operation === 'load').length,
    };
  })()`);
  assert.deepEqual(recoveredState, {
    status: 'ready', error: null, currentErrorCount: 0, noticeCount: 0, retainedLegacyCount: 1,
  });
  const db = openNodeDatabase({ readonly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM conversation_client_notices').get().count, 1);
  } finally {
    db.close();
  }
  await assertRendererHealthy(cdp, rendererErrors, '读取恢复后当前提示消失且旧错误不再显示');
}
