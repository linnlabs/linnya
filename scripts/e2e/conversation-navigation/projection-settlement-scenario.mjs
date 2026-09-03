export async function runProjectionSettlementReplay({
  cdp,
  rendererErrors,
  evaluate,
  waitFor,
  assertRendererHealthy,
}) {
  const replay = await evaluate(cdp, `(async () => {
    const { useAssistantStore } = await import(
      '/apps/renderer/domains/conversation/store/assistantStore.ts'
    );
    const assistantStore = useAssistantStore();
    const conversationId = 'e2e-conversation-a';
    const runId = 'e2e-sanitized-projection-run';
    const executionId = 'e2e-sanitized-projection-execution';
    const rootTurnId = 'e2e-sanitized-root-turn';
    const childTurnId = 'e2e-sanitized-child-turn';
    const parentToolCallId = 'e2e-sanitized-subagent-call';
    const subrunId = 'e2e-sanitized-subrun';
    const childToolCallId = 'e2e-sanitized-knowledge-call';
    const now = Date.now();
    const scope = {
      conversation_id: conversationId,
      run_id: runId,
      execution_id: executionId,
    };
    const events = [
      {
        ...scope,
        type: 'thought',
        id: 'e2e-sanitized-thought-a-complete-event',
        timestamp: now,
        turn_id: rootTurnId,
        thought_message_id: 'e2e-sanitized-thought-a',
        content: '第一段脱敏思考完成。',
        is_complete: true,
        metadata: { thought_started_at: now - 5, thought_completed_at: now },
      },
      {
        ...scope,
        type: 'thought',
        id: 'e2e-sanitized-thought-b-delta-event',
        timestamp: now + 1,
        turn_id: rootTurnId,
        thought_message_id: 'e2e-sanitized-thought-b',
        delta: '第二段脱敏思考开始',
        is_complete: false,
        metadata: { thought_started_at: now + 1 },
      },
      {
        ...scope,
        type: 'thought',
        id: 'e2e-sanitized-thought-b-complete-event',
        timestamp: now + 2,
        turn_id: rootTurnId,
        thought_message_id: 'e2e-sanitized-thought-b',
        content: '第二段脱敏思考完成。',
        is_complete: true,
        metadata: { thought_started_at: now + 1, thought_completed_at: now + 2 },
      },
      {
        ...scope,
        type: 'tool_call_decision',
        id: 'e2e-sanitized-subagent-decision',
        timestamp: now + 3,
        turn_id: rootTurnId,
        tool_name: 'subagent',
        tool_call_id: parentToolCallId,
        phase: 'start',
        status: 'loading',
        args: {
          description: '验证失败步骤投影',
          prompt: '运行脱敏的知识库失败事件',
          subagent_type: 'general',
        },
        payload: {
          args: {
            description: '验证失败步骤投影',
            prompt: '运行脱敏的知识库失败事件',
            subagent_type: 'general',
          },
        },
      },
      {
        ...scope,
        type: 'subrun_trace',
        id: 'e2e-sanitized-child-decision',
        timestamp: now + 4,
        turn_id: childTurnId,
        parent_tool_call_id: parentToolCallId,
        subrun_id: subrunId,
        source_event_id: 'e2e-sanitized-child-decision-source',
        kind: 'tool_call_decision',
        tool_calls: [{
          tool_call_id: childToolCallId,
          tool_name: 'knowledge_search',
          args: { query: 'beta 功能', doc_id: '', deep_search: false },
        }],
      },
      {
        ...scope,
        type: 'subrun_trace',
        id: 'e2e-sanitized-child-output',
        timestamp: now + 5,
        turn_id: childTurnId,
        parent_tool_call_id: parentToolCallId,
        subrun_id: subrunId,
        source_event_id: 'e2e-sanitized-child-output-source',
        kind: 'tool_output',
        tool_name: 'knowledge_search',
        tool_call_id: childToolCallId,
        status: 'error',
        output: { error: 'doc_id must not be empty' },
      },
    ];
    const results = [];
    for (const event of events) {
      results.push(await assistantStore.handleSseEvent(conversationId, event));
    }
    // 高频 projection 按产品约定在 50ms commit window 内合并；等待正式提交后再读 Vue 快照。
    await new Promise(resolveCommit => setTimeout(resolveCommit, 100));
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const messages = assistantStore.activeMessages;
    const thoughts = messages
      .filter(message => message.type === 'thought' && message.id.startsWith('e2e-sanitized-thought-'))
      .map(message => ({
        id: message.id,
        content: message.content,
        isComplete: message.metadata.is_complete,
      }));
    const parent = messages.find(message => (
      message.type === 'tool_calls'
      && message.metadata.tool_call_id === parentToolCallId
    ));
    const trace = parent?.type === 'tool_calls'
      ? parent.metadata.subrunTrace?.[subrunId]
      : undefined;
    return {
      results,
      thoughts,
      parentStatus: parent?.type === 'tool_calls' ? parent.metadata.status : null,
      traceVersion: parent?.type === 'tool_calls' ? parent.metadata.subrunTraceVersion : null,
      traceKinds: trace?.events?.map(event => event.kind) ?? [],
    };
  })()`);

  if (
    !Array.isArray(replay?.results)
    || replay.results.some(result => result?.success !== true)
    || JSON.stringify(replay.thoughts) !== JSON.stringify([
      {
        id: 'e2e-sanitized-thought-a',
        content: '第一段脱敏思考完成。',
        isComplete: true,
      },
      {
        id: 'e2e-sanitized-thought-b',
        content: '第二段脱敏思考完成。',
        isComplete: true,
      },
    ])
    || replay.parentStatus !== 'loading'
    || replay.traceVersion !== 2
    || JSON.stringify(replay.traceKinds) !== JSON.stringify(['tool_call_decision', 'tool_output'])
  ) {
    throw new Error(`脱敏投影回放结果异常: ${JSON.stringify(replay)}`);
  }

  try {
    await waitFor(async () => {
      if (rendererErrors.length > 0) return false;
      return evaluate(cdp, `(() => {
        const thoughtA = document.querySelector(
          '[data-conversation-message-id="e2e-sanitized-thought-a"]'
        );
        const thoughtB = document.querySelector(
          '[data-conversation-message-id="e2e-sanitized-thought-b"]'
        );
        const failedStep = Array.from(document.querySelectorAll('.subrun-trace-panel .deep-trace__row'))
          .find(row => row.querySelector('.deep-trace__dot.is-error'));
        return thoughtA instanceof HTMLElement
          && thoughtB instanceof HTMLElement
          && failedStep?.textContent?.includes('搜索知识库时发生错误') === true
          && failedStep?.textContent?.includes('beta 功能') !== true;
      })()`);
    }, 'Thought 分段与 Subrun error 步骤完成真实 Renderer 投影', 10_000);
  } catch (error) {
    const diagnostic = await evaluate(cdp, `(() => ({
      renderedMessageIds: Array.from(
        document.querySelectorAll('[data-conversation-message-id]'),
        element => element.getAttribute('data-conversation-message-id'),
      ),
      thoughtRows: Array.from(document.querySelectorAll('.thought-message'), element => element.textContent),
      traceRows: Array.from(document.querySelectorAll('.subrun-trace-panel .deep-trace__row'), row => ({
        text: row.textContent,
        isError: Boolean(row.querySelector('.deep-trace__dot.is-error')),
      })),
      tailText: document.body.innerText.slice(-2000),
    }))()`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; DOM=${JSON.stringify(diagnostic)}`,
    );
  }
  await assertRendererHealthy(cdp, rendererErrors, '脱敏投影回放完成后');

  const parentFailure = await evaluate(cdp, `(async () => {
    const { useAssistantStore } = await import(
      '/apps/renderer/domains/conversation/store/assistantStore.ts'
    );
    return useAssistantStore().handleSseEvent('e2e-conversation-a', {
      type: 'tool_output',
      id: 'e2e-sanitized-subagent-output',
      timestamp: Date.now(),
      conversation_id: 'e2e-conversation-a',
      turn_id: 'e2e-sanitized-root-turn',
      run_id: 'e2e-sanitized-projection-run',
      execution_id: 'e2e-sanitized-projection-execution',
      tool_name: 'subagent',
      tool_call_id: 'e2e-sanitized-subagent-call',
      status: 'error',
      observation: '子任务报告了预期的工具失败。',
      error: 'child tool failed',
    });
  })()`);
  if (parentFailure?.success !== true) {
    throw new Error(`父 Subrun 失败终态未被接纳: ${JSON.stringify(parentFailure)}`);
  }
  await waitFor(
    () => evaluate(
      cdp,
      `Boolean(document.querySelector('.conversation-visual-row__waiting-indicator'))`,
    ),
    '父工具结束后共享 waiting owner 接管尾部',
  );

  const readTailGeometry = () => evaluate(cdp, `(async () => {
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const canvas = document.querySelector('.conversation-message-canvas');
    const tails = Array.from(document.querySelectorAll('.conversation-visual-row__tail'));
    const indicator = document.querySelector('.conversation-visual-row__waiting-indicator');
    return {
      canvasHeight: canvas instanceof HTMLElement ? canvas.getBoundingClientRect().height : null,
      canvasScrollHeight: canvas instanceof HTMLElement ? canvas.scrollHeight : null,
      tailCount: tails.length,
      tailHeight: tails.at(-1)?.getBoundingClientRect().height ?? null,
      indicatorCount: document.querySelectorAll('.conversation-visual-row__waiting-indicator').length,
      indicatorVisible: indicator?.classList.contains('is-visible') === true,
    };
  })()`);
  const beforeIndicator = await readTailGeometry();
  if (
    beforeIndicator.tailCount !== 1
    || beforeIndicator.tailHeight !== 42
    || beforeIndicator.indicatorCount !== 1
  ) {
    throw new Error(`等待图标显示前 tail geometry 异常: ${JSON.stringify(beforeIndicator)}`);
  }

  await waitFor(
    () => evaluate(
      cdp,
      `document.querySelector('.conversation-visual-row__waiting-indicator')?.classList.contains('is-visible') === true`,
    ),
    '通用等待图标按 3 秒策略显示',
    6_000,
  );
  const afterIndicator = await readTailGeometry();
  if (
    afterIndicator.tailCount !== beforeIndicator.tailCount
    || afterIndicator.tailHeight !== beforeIndicator.tailHeight
    || afterIndicator.canvasHeight !== beforeIndicator.canvasHeight
    || afterIndicator.canvasScrollHeight !== beforeIndicator.canvasScrollHeight
  ) {
    throw new Error(
      `等待图标显隐改变了 tail geometry: before=${JSON.stringify(beforeIndicator)}, after=${JSON.stringify(afterIndicator)}`,
    );
  }

  const terminal = await evaluate(cdp, `(async () => {
    const { useAssistantStore } = await import(
      '/apps/renderer/domains/conversation/store/assistantStore.ts'
    );
    return useAssistantStore().handleSseEvent('e2e-conversation-a', {
      type: 'run_status',
      id: 'e2e-sanitized-run-completed',
      timestamp: Date.now(),
      conversation_id: 'e2e-conversation-a',
      turn_id: 'e2e-sanitized-root-turn',
      run_id: 'e2e-sanitized-projection-run',
      execution_id: 'e2e-sanitized-projection-execution',
      status: 'completed',
    });
  })()`);
  if (terminal?.success !== true) {
    throw new Error(`脱敏回放终态未被接纳: ${JSON.stringify(terminal)}`);
  }
  await waitFor(
    () => evaluate(cdp, `(async () => {
      const { useAssistantStore } = await import(
        '/apps/renderer/domains/conversation/store/assistantStore.ts'
      );
      return useAssistantStore().activeConversationIsStreaming === false
        && !document.querySelector('.conversation-visual-row__waiting-indicator');
    })()`),
    'run 终态释放 waiting owner',
  );
  const afterTerminal = await readTailGeometry();
  if (
    afterTerminal.tailCount !== 1
    || afterTerminal.indicatorCount !== 0
    || afterTerminal.tailHeight !== beforeIndicator.tailHeight
    || afterTerminal.canvasHeight !== beforeIndicator.canvasHeight
    || afterTerminal.canvasScrollHeight !== beforeIndicator.canvasScrollHeight
  ) {
    throw new Error(
      `run 终态没有稳定释放 waiting owner: before=${JSON.stringify(beforeIndicator)}, terminal=${JSON.stringify(afterTerminal)}`,
    );
  }
  await assertRendererHealthy(cdp, rendererErrors, '脱敏投影终态收尾后');
}
