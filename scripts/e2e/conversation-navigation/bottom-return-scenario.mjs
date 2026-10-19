import assert from 'node:assert/strict';

export function seedBottomReturnHistory(db) {
  const conversationId = 'e2e-conversation-b';
  db.prepare('UPDATE conversation_ui_messages SET payload_json = ? WHERE message_id = ?').run(
    JSON.stringify({ context_usage: {
      budget_model_id: 'e2e-model', used_tokens: 60_000,
      components: { system_prompt_tokens: 10_000, conversation_tokens: 40_000, tool_definition_tokens: 10_000 },
      input_budget_tokens: 100_000, remaining_tokens: 40_000, output_limit_tokens: 20_000,
      source: 'test-fixture', confidence: 'estimate',
    } }), `${conversationId}-user-24`,
  );
  const insert = db.prepare(`INSERT INTO conversation_ui_messages (
    message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp,
    content, payload_json, run_id
  ) VALUES (?, ?, ?, 'assistant', 'final_answer', ?, ?, ?, ?, ?)`);
  // 同一轮追加 400 条助手消息，让用量来源同时落在 80 条尾页和 320 条保留窗之外。
  for (let index = 49; index <= 448; index += 1) {
    const id = `${conversationId}-long-answer-${index}`;
    insert.run(id, conversationId, `${conversationId}-turn-24`, index, Date.now() + index,
      `长轮次消息 ${index}\n\n${'用于验证历史导航和上下文用量。'.repeat(8)}`,
      JSON.stringify({ answer_id: id, is_complete: true, completion_reason: 'terminal', first_token_at: Date.now() }),
      `${conversationId}-run-24`);
  }
}

export async function runBottomReturnScenario({ cdp, evaluate, waitFor }) {
  await cdp.send('Network.enable');
  const requests = [];
  const stop = cdp.onEvent(event => {
    if (event.method === 'Network.requestWillBeSent' && /\/ui-messages\/(tail|before|after)/.test(event.params.request.url)) {
      requests.push(new URL(event.params.request.url).pathname.split('/').at(-1));
    }
  });
  const state = () => evaluate(cdp, `(async () => {
    const { useMessageWindowStore } = await import('/apps/renderer/domains/conversation/message-window/store/messageWindowStore.ts');
    const { resolveScrollContainer } = await import('/apps/renderer/domains/conversation/ui/conversationView/utils/resolveScrollContainer.ts');
    const store = useMessageWindowStore();
    const root = document.querySelector('.conversation-view');
    const viewport = root && resolveScrollContainer(root);
    return {
      ready: store.status === 'ready', before: store.hasMoreBefore, after: store.hasMoreAfter,
      rows: store.rows.length, users: store.rows.filter(row => row.message.type === 'user_input').length,
      distance: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
      top: viewport?.scrollTop,
      footer: document.querySelector('.panel-footer')?.getBoundingClientRect().height,
      content: root?.getBoundingClientRect().height,
      usage: document.querySelector('.context-window-usage-trigger__value')?.getAttribute('stroke-dasharray'),
    };
  })()`);
  const scroll = direction => evaluate(cdp, `(async () => {
    const { resolveScrollContainer } = await import('/apps/renderer/domains/conversation/ui/conversationView/utils/resolveScrollContainer.ts');
    const root = document.querySelector('.conversation-view');
    const viewport = root && resolveScrollContainer(root);
    if (!viewport) throw new Error('missing viewport');
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: ${direction === 'top' ? -500 : 500} }));
    viewport.scrollTop = ${direction === 'top' ? '0' : 'viewport.scrollHeight'};
    viewport.dispatchEvent(new Event('scroll'));
  })()`);
  const reach = async direction => {
    await waitFor(async () => {
      const current = await state();
      if (!current.ready) return false;
      await scroll(direction);
      return direction === 'top' ? !current.before && current.top < 2 : !current.after && current.distance < 2;
    }, `手动滚到${direction}`);
  };
  try {
    await evaluate(cdp, `Array.from(document.querySelectorAll('.chat-list-item'))
      .find(item => item.textContent.includes('E2E 对话 B')).click()`);
    await waitFor(async () => (await state()).usage, '初始尾页用量');
    await reach('top');
    console.log('[bottom-return-e2e] reached history start', await state());
    const requestStart = requests.length;
    await evaluate(cdp, `document.querySelector('.conversation-scroll-to-bottom').click()`);
    await waitFor(async () => {
      const current = await state();
      return current.ready && !current.after && current.distance < 2 && current.usage ? current : false;
    }, '按钮导航到真实底部并恢复用量', 8000);
    // 观察窗口落定后的延迟 scroll/ResizeObserver，不允许隐式追加历史分页。
    await new Promise(resolve => setTimeout(resolve, 600));
    const clicked = await state();
    assert.deepEqual(requests.slice(requestStart), ['tail']);
    assert.ok(clicked.distance < 2, `bottom drifted by ${clicked.distance}px`);
    assert.equal(clicked.rows, 80);
    assert.equal(clicked.users, 0);
    assert.equal(clicked.usage, '50 100');
    await reach('top');
    await reach('bottom');
    const manual = await state();
    assert.equal(manual.usage, clicked.usage);
    assert.equal(manual.users, 0);
    assert.equal(manual.rows, 320);
    console.log('[bottom-return-e2e]', JSON.stringify({ clicked, manual, requests }));
  } catch (error) {
    console.error('[bottom-return-e2e] failed state', await state(), requests);
    throw error;
  } finally {
    stop();
  }
}
