import type { ResolvedBenchmarkCase } from '../definitions/benchmarkCase';
import type { BenchmarkRunFacts } from '../definitions/benchmarkRun';

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDuration(durationMs: number): string {
  const safeDurationMs = Math.max(0, durationMs);
  if (safeDurationMs < 60_000) {
    return `${(Math.round(safeDurationMs / 100) / 10).toFixed(1)} 秒`;
  }
  const totalSeconds = Math.round(safeDurationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    ...(hours > 0 ? [`${hours} 小时`] : []),
    ...(minutes > 0 ? [`${minutes} 分`] : []),
    ...(seconds > 0 || (hours === 0 && minutes === 0) ? [`${seconds} 秒`] : []),
  ].join(' ');
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '不可计算';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

interface AuditTokenTotals {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_tokens_reported?: number;
  readonly cache_write_tokens_reported?: number;
}

/**
 * audit 的 input_tokens 对应 CanonicalLlmUsage.inputTokens，只包含非缓存输入。
 * Provider 总输入必须把 cache read / write 加回去，禁止用非缓存输入充当缓存率分母。
 */
function resolveProviderTokenTotals(tokens: AuditTokenTotals): {
  uncachedInput: number;
  providerInput: number;
  inputAndOutput: number;
} {
  const providerInput = tokens.input_tokens
    + (tokens.cache_read_tokens_reported ?? 0)
    + (tokens.cache_write_tokens_reported ?? 0);
  return {
    uncachedInput: tokens.input_tokens,
    providerInput,
    inputAndOutput: providerInput + tokens.output_tokens,
  };
}

function renderManagementSummary(facts: BenchmarkRunFacts): string[] {
  if (facts.audit.status !== 'available') {
    return [
      `- 控制面结果：\`${facts.outcome}\`；执行审计${facts.audit.status === 'unavailable' ? `不可用（${escapeCell(facts.audit.code)}）` : '未请求'}。`,
      '- 视觉、内容和导出质量仍须人工验收，不能从运行终态推断。',
    ];
  }
  const audit = facts.audit.response;
  const childRuns = audit.runs.filter(run => run.parent_run_id !== undefined);
  const tokenTotals = resolveProviderTokenTotals(audit.llm.actual_tokens);
  return [
    `- 控制面结果：\`${facts.outcome}\`；总墙钟 ${formatDuration(facts.durationMs)}。`,
    `- 执行拓扑：${audit.runs.length} 个 Run，其中 ${childRuns.length} 个 child Run；LLM ${audit.llm.calls} 次，工具 ${audit.tools.calls} 次。`,
    `- Provider actual：总输入 ${formatInteger(tokenTotals.providerInput)}（非缓存 ${formatInteger(tokenTotals.uncachedInput)}），输出 ${formatInteger(audit.llm.actual_tokens.output_tokens)}；usage 覆盖率 ${formatPercent(audit.llm.provider_actual_calls, audit.llm.calls)}。`,
    `- 上下文压缩：完成 ${audit.context_compaction.completed} 次 / Provider attempt ${audit.context_compaction.attempts} 次，覆盖 ${audit.context_compaction.by_run.length} 个 Run。`,
    `- 工具状态失败 ${audit.tools.failed_calls} 次，失败率 ${formatPercent(audit.tools.failed_calls, audit.tools.calls)}；decision/output 配对${audit.tool_pairing.complete ? '完整' : '不完整'}。`,
    `- Shell / Process：${audit.commands.executions} 个命令执行，非零退出 ${audit.commands.nonzero_exit_executions} 个，runtime failure ${audit.commands.runtime_failure_executions} 个。`,
    `- 产物期望：${facts.benchmark.artifactExpectation}`,
    '- 本节只总结机器事实，不自动判断 PPT 是否通过视觉与内容验收。',
  ];
}

function resolveExecutionEnd(facts: BenchmarkRunFacts): number {
  if (facts.stop) return facts.stop.completed_at;
  if (facts.result) return facts.result.completedAt;
  if (facts.audit.status === 'available' && facts.receipt) {
    const root = facts.audit.response.runs.find(run => run.run_id === facts.receipt?.run_id);
    if (root) return root.updated_at;
  }
  return facts.finishedAt;
}

function renderPhaseTiming(facts: BenchmarkRunFacts): string[] {
  const acceptedAt = facts.receipt?.accepted_at ?? facts.startedAt;
  const awaitingFrame = facts.statusFrames.find(frame => frame.snapshot?.status === 'awaiting_user');
  const resumedFrame = awaitingFrame
    ? facts.statusFrames.find(
        frame => frame.observed_at > awaitingFrame.observed_at && frame.snapshot?.status === 'running',
      )
    : undefined;
  const executionEnd = resolveExecutionEnd(facts);
  const phases: Array<{ name: string; start: number; end: number; evidence: string }> = [];

  if (awaitingFrame) {
    phases.push({
      name: '接纳后至等待用户',
      start: acceptedAt,
      end: awaitingFrame.observed_at,
      evidence: `首次观测 awaiting_user / ${awaitingFrame.snapshot?.current_node ?? 'unknown'}`,
    });
  }
  if (awaitingFrame && resumedFrame) {
    phases.push({
      name: '等待与自动回应',
      start: awaitingFrame.observed_at,
      end: resumedFrame.observed_at,
      evidence: `${facts.interactionResponses.length} 次 respond`,
    });
  }
  phases.push({
    name: awaitingFrame ? '批准后执行' : '接纳后执行',
    start: resumedFrame?.observed_at ?? acceptedAt,
    end: executionEnd,
    evidence: facts.stop ? facts.stop.requested_reason : `终态 ${facts.outcome}`,
  });
  if (facts.finishedAt > executionEnd) {
    phases.push({
      name: '终态后报告采集',
      start: executionEnd,
      end: facts.finishedAt,
      evidence: 'result / messages / audit / 文件写入',
    });
  }

  return [
    '> 阶段时间来自 CLI 接纳、状态观测与终态时间；它反映测试控制面的墙钟，不冒充每个内部节点的精确开始时间。',
    '',
    '| 阶段 | 开始 | 结束 | 耗时 | 证据 |',
    '| --- | --- | --- | ---: | --- |',
    ...phases.map(phase =>
      `| ${phase.name} | ${new Date(phase.start).toISOString()} | ${new Date(phase.end).toISOString()} | ${formatDuration(phase.end - phase.start)} | ${escapeCell(phase.evidence)} |`,
    ),
    `| **总墙钟** | ${new Date(facts.startedAt).toISOString()} | ${new Date(facts.finishedAt).toISOString()} | **${formatDuration(facts.durationMs)}** | Runner 计时 |`,
  ];
}

function renderStatusTimeline(facts: BenchmarkRunFacts): string[] {
  if (facts.statusFrames.length === 0) return ['未采集到状态变化帧。'];
  return [
    '| 序号 | 观测时间 | 状态 | 节点 | Execution 步数 | Run 累计步数 | 等待工具 |',
    '| ---: | --- | --- | --- | ---: | ---: | --- |',
    ...facts.statusFrames.map((frame, index) => {
      const snapshot = frame.snapshot;
      return `| ${index} | ${new Date(frame.observed_at).toISOString()} | ${snapshot?.status ?? 'not_found'} | ${escapeCell(snapshot?.current_node ?? '')} | ${snapshot?.execution_steps_used ?? '—'} | ${snapshot?.run_iterations_used ?? snapshot?.iterations_used ?? '—'} | ${escapeCell(snapshot?.pending_interaction?.tool_name ?? '')} |`;
    }),
  ];
}

function renderSourceCompleteness(facts: BenchmarkRunFacts): string[] {
  if (facts.audit.status !== 'available') {
    return [
      `- 审计状态：${facts.audit.status}`,
      ...(facts.audit.status === 'unavailable'
        ? [`- 原因：${facts.audit.code} — ${facts.audit.message}`]
        : []),
    ];
  }
  const audit = facts.audit.response;
  return [
    `- RunRegistry：${audit.completeness.run_registry}。`,
    `- EventStore：${audit.completeness.event_store}；工具 decision/output 与命令终态来自 durable 事实。`,
    `- Telemetry：${audit.completeness.telemetry}，默认保留 ${audit.completeness.telemetry_retention_days} 天；缺失观测不会补零。`,
    `- Durable 事件事实：${audit.source_window.event_facts}；Telemetry 事件：${audit.source_window.telemetry_events}；Telemetry 窗口 ${audit.source_window.earliest_telemetry_at === undefined ? '未知' : new Date(audit.source_window.earliest_telemetry_at).toISOString()} — ${audit.source_window.latest_telemetry_at === undefined ? '未知' : new Date(audit.source_window.latest_telemetry_at).toISOString()}。`,
    '- 安全摘要不包含 prompt、隐藏思考、工具参数正文、原始 stdout/stderr 或外站错误正文。',
  ];
}

function renderRunTopology(facts: BenchmarkRunFacts): string[] {
  if (facts.audit.status !== 'available' || facts.audit.response.runs.length === 0) {
    return ['没有可用的 RunRegistry 投影。'];
  }
  const lifecycleByRun = new Map(
    facts.audit.response.run_lifecycle.by_run.map(summary => [summary.run_id, summary]),
  );
  return [
    '| Run | Parent | Agent | 状态 | Execution 步数 | Run 累计步数 | Telemetry 步数 / 上限 | 终止原因 | 开始 | 更新/终态 | 耗时 | 错误码 |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |',
    ...facts.audit.response.runs.map(run => {
      const lifecycle = lifecycleByRun.get(run.run_id);
      return `| ${escapeCell(run.run_id)} | ${escapeCell(run.parent_run_id ?? 'root')} | ${escapeCell(run.agent_id ?? '未上报')} | ${run.status} | ${run.execution_steps_used ?? '—'} | ${run.run_iterations_used ?? run.iterations_used ?? '—'} | ${lifecycle ? `${lifecycle.steps_used} / ${lifecycle.max_steps}` : '—'} | ${escapeCell(lifecycle?.terminal_reason ?? '未观测')} | ${new Date(run.started_at).toISOString()} | ${new Date(run.updated_at).toISOString()} | ${formatDuration(run.updated_at - run.started_at)} | ${escapeCell(run.error_code ?? '')} |`;
    }),
  ];
}

function renderLlmAudit(facts: BenchmarkRunFacts): string[] {
  if (facts.audit.status !== 'available') return ['没有可用的 LLM 审计摘要。'];
  const llm = facts.audit.response.llm;
  const tokens = llm.actual_tokens;
  const tokenTotals = resolveProviderTokenTotals(tokens);
  const inputOutputRatio = tokens.output_tokens > 0
    ? `${(tokenTotals.providerInput / tokens.output_tokens).toFixed(1)}:1`
    : '不可计算';
  const cacheRatio = tokens.cache_read_tokens_reported === undefined
    ? '未上报'
    : formatPercent(tokens.cache_read_tokens_reported, tokenTotals.providerInput);
  const lines = [
    `- LLM 调用：${llm.calls}；累计模型耗时 ${formatDuration(llm.duration_ms)}。累计耗时可能包含 child Run，不与墙钟机械相加。`,
    `- Usage 覆盖：actual ${llm.provider_actual_calls} / estimate ${llm.estimate_calls} / missing ${llm.missing_usage_calls}，actual 覆盖率 ${formatPercent(llm.provider_actual_calls, llm.calls)}。`,
    `- Provider actual 总输入 ${formatInteger(tokenTotals.providerInput)}（非缓存 ${formatInteger(tokenTotals.uncachedInput)}）；输出 ${formatInteger(tokens.output_tokens)}；可加总 input+output ${formatInteger(tokenTotals.inputAndOutput)}。`,
    `- 平均每次调用总输入 ${llm.calls > 0 ? formatInteger(Math.round(tokenTotals.providerInput / llm.calls)) : '不可计算'}；输出 ${llm.calls > 0 ? formatInteger(Math.round(tokens.output_tokens / llm.calls)) : '不可计算'}；输入/输出比 ${inputOutputRatio}。`,
    `- Cache read ${tokens.cache_read_tokens_reported === undefined ? '未上报' : formatInteger(tokens.cache_read_tokens_reported)}；占 Provider 总输入 ${cacheRatio}。当前聚合不提供“命中过缓存的请求次数”，不能把 token 占比写成请求命中率。`,
    `- Reasoning ${tokens.reasoning_tokens_reported === undefined ? '未上报' : formatInteger(tokens.reasoning_tokens_reported)}；它是输出子集，不重复计入总量。`,
  ];

  if (llm.by_model.length > 0) {
    lines.push(
      '',
      '| Model | Calls | 累计耗时 | Actual / Estimate / Missing | 总输入 | 非缓存输入 | Output | Cache read |',
      '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |',
      ...llm.by_model.map(model => {
        const modelTotals = resolveProviderTokenTotals(model.actual_tokens);
        return `| ${escapeCell(model.model_id)} | ${model.calls} | ${formatDuration(model.duration_ms)} | ${model.provider_actual_calls} / ${model.estimate_calls} / ${model.missing_usage_calls} | ${formatInteger(modelTotals.providerInput)} | ${formatInteger(modelTotals.uncachedInput)} | ${formatInteger(model.actual_tokens.output_tokens)} | ${model.actual_tokens.cache_read_tokens_reported === undefined ? '未上报' : formatInteger(model.actual_tokens.cache_read_tokens_reported)} |`;
      }),
    );
  }
  return lines;
}

function renderToolAudit(facts: BenchmarkRunFacts): string[] {
  if (facts.audit.status !== 'available') return ['没有可用的工具审计摘要。'];
  const audit = facts.audit.response;
  const tools = audit.tools;
  const sorted = [...tools.by_tool]
    .filter(tool => tool.calls > 0)
    .sort((left, right) => right.duration_ms - left.duration_ms);
  const pairing = audit.tool_pairing;
  const commands = audit.commands;
  const pairingRecords = [...pairing.records].sort((left, right) => {
    if (left.pairing_status === right.pairing_status) {
      return left.tool_call_id.localeCompare(right.tool_call_id);
    }
    if (left.pairing_status === 'paired') return 1;
    if (right.pairing_status === 'paired') return -1;
    return left.pairing_status.localeCompare(right.pairing_status);
  });
  const commandRecords = [...commands.by_execution].sort(
    (left, right) => left.emitted_at - right.emitted_at,
  );
  return [
    '### 工具状态聚合',
    '',
    `- 工具调用 ${tools.calls}；状态失败 ${tools.failed_calls}；失败率 ${formatPercent(tools.failed_calls, tools.calls)}；累计工具耗时 ${formatDuration(tools.duration_ms)}。`,
    '- 工具状态失败、Shell 子进程非零和 Slides 业务诊断是不同层级，不能混加。',
    '',
    ...(sorted.length === 0
      ? ['没有工具调用明细。']
      : [
          '| 工具 | 调用 | 成功 | 失败 | 平均耗时 | 累计耗时 | 错误码 |',
          '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
          ...sorted.map(tool =>
            `| ${escapeCell(tool.tool_name)} | ${tool.calls} | ${tool.calls - tool.failed_calls} | ${tool.failed_calls} | ${formatDuration(tool.duration_ms / tool.calls)} | ${formatDuration(tool.duration_ms)} | ${escapeCell(tool.error_codes.join(', ') || '')} |`,
          ),
        ]),
    '',
    '### 调用配对完整度',
    '',
    `- 完整性：${pairing.complete ? '完整' : '不完整'}；paired ${pairing.paired}，decision missing ${pairing.decision_missing}，terminal missing ${pairing.terminal_missing}，duplicate terminal ${pairing.duplicate_terminal}，名称不一致 ${pairing.name_mismatches}。`,
    '',
    ...(pairingRecords.length === 0
      ? ['没有 durable tool decision/output 记录。']
      : [
          '| Run | Parent | Tool call | 工具 | 配对状态 | Decision / Terminal | Tool 终态 | 名称一致 |',
          '| --- | --- | --- | --- | --- | ---: | --- | --- |',
          ...pairingRecords.map(record =>
            `| ${escapeCell(record.run_id)} | ${escapeCell(record.parent_run_id ?? 'root')} | ${escapeCell(record.tool_call_id)} | ${escapeCell(record.tool_name)} | ${record.pairing_status} | ${record.decision_count} / ${record.terminal_count} | ${record.terminal_status ?? '—'} | ${record.name_consistent ? '是' : '否'} |`,
          ),
        ]),
    '',
    '### Shell / Process 命令终态',
    '',
    `- 命令执行 ${commands.executions}；durable 终态观测 ${commands.terminal_observations}；非零退出 ${commands.nonzero_exit_executions}；runtime failure ${commands.runtime_failure_executions}。`,
    '- 命令终态只记录安全元数据，不包含 argv、stdout 或 stderr。',
    '',
    ...(commandRecords.length === 0
      ? ['没有 Shell / Process 命令终态记录。']
      : [
          '| 时间 | Run | Tool call | Command execution | 观测数 | Outcome | Process exit | 结束原因 |',
          '| --- | --- | --- | --- | ---: | --- | --- | --- |',
          ...commandRecords.map(record => {
            const processExit = record.process_exit.status === 'observed'
              ? `exit=${record.process_exit.exit_code ?? 'null'}, signal=${record.process_exit.signal ?? 'null'}`
              : record.process_exit.status === 'unavailable'
                ? `unavailable: ${record.process_exit.reason}`
                : 'not_started';
            const reason = record.outcome === 'execution_ended'
              ? record.termination_cause
              : record.runtime_failure_code;
            return `| ${new Date(record.emitted_at).toISOString()} | ${escapeCell(record.run_id)} | ${escapeCell(record.tool_call_id)} | ${escapeCell(record.command_execution_id)} | ${record.terminal_observations} | ${record.outcome} | ${escapeCell(processExit)} | ${escapeCell(reason)} |`;
          }),
        ]),
  ];
}

function renderContextCompactionAudit(facts: BenchmarkRunFacts): string[] {
  if (facts.audit.status !== 'available') return ['没有可用的上下文压缩审计摘要。'];
  const compaction = facts.audit.response.context_compaction;
  if (compaction.observations === 0) {
    return [
      '本次审计窗口没有观察到 `context_compaction`。这可能表示未达到触发水位，也可能是 best-effort Telemetry 缺失；不能据此写成“压缩功能未运行”。',
    ];
  }

  const compactionTokenTotals = resolveProviderTokenTotals(compaction.actual_tokens);
  const allTokenTotals = resolveProviderTokenTotals(facts.audit.response.llm.actual_tokens);
  const cacheRead = compaction.actual_tokens.cache_read_tokens_reported;
  const compactionEvents = compaction.by_run.flatMap(run => run.events);
  const measuredInputEvents = compactionEvents.filter(
    event => event.generation_attempted && event.compaction_input_tokens !== undefined,
  ).length;
  const lifecycleByRun = new Map(
    facts.audit.response.run_lifecycle.by_run.map(summary => [summary.run_id, summary]),
  );
  const runStatusById = new Map(
    facts.audit.response.runs.map(run => [run.run_id, run.status]),
  );
  const lines = [
    `- 观测 ${compaction.observations} 条；Provider attempt ${compaction.attempts} 次；完成 ${compaction.completed}，失败 ${compaction.failed}，空间不足 ${compaction.insufficient}，取消 ${compaction.aborted}，抑制 ${compaction.skipped}。`,
    `- 累计压缩耗时 ${formatDuration(compaction.duration_ms)}；已上报请求测量输入 ${compaction.compaction_input_tokens_reported === undefined ? '未上报' : formatInteger(compaction.compaction_input_tokens_reported)}，覆盖 ${measuredInputEvents} / ${compaction.attempts} 个 Provider attempt。`,
    `- 压缩事件附着 usage：actual ${compaction.provider_actual_calls} / estimate ${compaction.estimate_calls} / missing ${compaction.missing_usage_calls}；已附着 Provider actual 总输入 ${formatInteger(compactionTokenTotals.providerInput)}（非缓存 ${formatInteger(compactionTokenTotals.uncachedInput)}），占全部 Provider actual 总输入 ${formatPercent(compactionTokenTotals.providerInput, allTokenTotals.providerInput)}。`,
    `- Provider actual cache read ${cacheRead === undefined ? '未上报' : formatInteger(cacheRead)}；占压缩 actual 总输入 ${cacheRead === undefined ? '不可计算' : formatPercent(cacheRead, compactionTokenTotals.providerInput)}。`,
    `- 成功压缩累计释放 ${compaction.released_tokens_reported === undefined ? '未上报' : formatInteger(compaction.released_tokens_reported)} tokens；摘要输出累计 ${compaction.summary_output_tokens_reported === undefined ? '未上报' : formatInteger(compaction.summary_output_tokens_reported)} tokens。`,
    '- 压缩失败是否阻断主任务只能与同 Run 的权威终态和 terminal reason 联合判断；报告不从单条失败事件猜因果。',
    '',
    '| Run | Parent | 完成 / 护栏 | Provider attempt | 失败 / 不足 / 取消 / 抑制 | 耗时 | 请求输入 | 释放 | Actual cache read | Run 终态 | Terminal reason |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |',
    ...compaction.by_run.map(run => {
      const lifecycle = lifecycleByRun.get(run.run_id);
      return `| ${escapeCell(run.run_id)} | ${escapeCell(run.parent_run_id ?? 'root')} | ${run.completed} / ${run.max_compactions_per_run} | ${run.attempts} | ${run.failed} / ${run.insufficient} / ${run.aborted} / ${run.skipped} | ${formatDuration(run.duration_ms)} | ${run.compaction_input_tokens_reported === undefined ? '—' : formatInteger(run.compaction_input_tokens_reported)} | ${run.released_tokens_reported === undefined ? '—' : formatInteger(run.released_tokens_reported)} | ${run.actual_tokens.cache_read_tokens_reported === undefined ? '—' : formatInteger(run.actual_tokens.cache_read_tokens_reported)} | ${runStatusById.get(run.run_id) ?? '未上报'} | ${escapeCell(lifecycle?.terminal_reason ?? '未观测')} |`;
    }),
    '',
    '### 压缩触发明细',
    '',
    '| 时间 | Run | 序号 / 护栏 | Provider attempt | 水位（触发→目标） | Before / Budget | After / 释放率 | 请求输入 | 摘要输出 / 比率 | Actual 总输入 / 非缓存 / output / cache | 结果 | 恢复/目标 | 原因 |',
    '| --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
  ];

  for (const run of compaction.by_run) {
    for (const event of run.events) {
      const released = event.after_tokens === undefined
        ? '—'
        : `${formatInteger(event.after_tokens)} / ${formatPercent(event.before_tokens - event.after_tokens, event.before_tokens)}`;
      const usage = event.usage
        ? (() => {
            const eventTotals = resolveProviderTokenTotals(event.usage);
            return `${formatInteger(eventTotals.providerInput)} / ${formatInteger(eventTotals.uncachedInput)} / ${formatInteger(event.usage.output_tokens)} / ${event.usage.cache_read_tokens_reported === undefined ? '—' : formatInteger(event.usage.cache_read_tokens_reported)} (${event.usage.confidence})`;
          })()
        : '未上报';
      const recovery = [
        ...(event.forced_phase_recovery ? ['强制收尾恢复'] : []),
        ...(event.target_unreachable ? ['目标不可达'] : []),
      ].join('，') || '—';
      const reason = event.suppressed_reason
        ?? event.failure_reason
        ?? event.error_code
        ?? '—';
      lines.push(
        `| ${new Date(event.emitted_at).toISOString()} | ${escapeCell(run.run_id)} | ${event.compaction_index} / ${event.max_compactions_per_run} | ${event.generation_attempted ? '是' : '否'} | ${(event.trigger_ratio * 100).toFixed(0)}%→${(event.target_ratio * 100).toFixed(0)}% | ${formatInteger(event.before_tokens)} / ${formatInteger(event.input_budget_tokens)} | ${released} | ${event.compaction_input_tokens === undefined ? '—' : formatInteger(event.compaction_input_tokens)} | ${event.summary_output_tokens === undefined ? '—' : formatInteger(event.summary_output_tokens)} / ${event.compression_ratio === undefined ? '—' : event.compression_ratio.toFixed(3)} | ${usage} | ${event.outcome} | ${recovery} | ${escapeCell(reason)} |`,
      );
    }
  }
  return lines;
}

function renderFailures(facts: BenchmarkRunFacts): string[] {
  const runFailures = facts.audit.status === 'available'
    ? facts.audit.response.runs.filter(run => run.status === 'failed' || run.status === 'cancelled')
    : [];
  const toolFailures = facts.audit.status === 'available'
    ? facts.audit.response.tools.by_tool.filter(tool => tool.failed_calls > 0)
    : [];
  const incompleteToolCalls = facts.audit.status === 'available'
    ? facts.audit.response.tool_pairing.records.filter(record => record.pairing_status !== 'paired')
    : [];
  const nonzeroCommands = facts.audit.status === 'available'
    ? facts.audit.response.commands.nonzero_exit_executions
    : 0;
  const commandRuntimeFailures = facts.audit.status === 'available'
    ? facts.audit.response.commands.runtime_failure_executions
    : 0;
  const lines = [
    `- Root 结果：\`${facts.outcome}\`${facts.stop ? `；stop 原因：${escapeCell(facts.stop.requested_reason)}` : ''}。`,
    `- Run 失败/取消记录：${runFailures.length}；工具状态失败：${toolFailures.reduce((sum, tool) => sum + tool.failed_calls, 0)}；工具配对异常：${incompleteToolCalls.length}；命令非零退出：${nonzeroCommands}；命令 runtime failure：${commandRuntimeFailures}；Runner/采集错误：${facts.errors.length}。`,
    '- 各层信号分别统计，不能相加成“总失败次数”。',
  ];
  if (runFailures.length > 0) {
    lines.push(
      '',
      '| Run | 状态 | Agent | 错误码 |',
      '| --- | --- | --- | --- |',
      ...runFailures.map(run =>
        `| ${escapeCell(run.run_id)} | ${run.status} | ${escapeCell(run.agent_id ?? '未上报')} | ${escapeCell(run.error_code ?? '未上报')} |`,
      ),
    );
  }
  if (toolFailures.length > 0) {
    lines.push(
      '',
      '| 失败工具 | 次数 | 稳定错误码 |',
      '| --- | ---: | --- |',
      ...toolFailures.map(tool =>
        `| ${escapeCell(tool.tool_name)} | ${tool.failed_calls} | ${escapeCell(tool.error_codes.join(', ') || '未上报')} |`,
      ),
    );
  }
  if (facts.errors.length > 0) {
    lines.push(
      '',
      '| 采集阶段 | 错误码 | 可重试 | 信息 |',
      '| --- | --- | --- | --- |',
      ...facts.errors.map(error =>
        `| ${escapeCell(error.stage)} | ${escapeCell(error.code)} | ${error.retryable ? '是' : '否'} | ${escapeCell(error.message)} |`,
      ),
    );
  }
  return lines;
}

function renderMessageSummary(facts: BenchmarkRunFacts): string[] {
  if (!facts.messages) return ['消息投影未采集。'];
  if (facts.messages.status === 'preparing') return ['消息投影仍在准备，不能把空结果解释为没有消息。'];
  const entries = Object.entries(facts.messages.byType ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return [
    `- 消息数：${facts.messages.count ?? 0}；Projection revision：${facts.messages.revision ?? '未上报'}；最新消息：${facts.messages.latestMessageId ?? '未上报'}。`,
    '',
    ...(entries.length === 0
      ? ['没有消息类型统计。']
      : [
          '| 消息类型 | 数量 |',
          '| --- | ---: |',
          ...entries.map(([type, count]) => `| ${escapeCell(type)} | ${count} |`),
        ]),
  ];
}

function renderFinalAnswer(facts: BenchmarkRunFacts): string[] {
  if (facts.result?.resultStatus !== 'available') {
    return [
      `未取得可用最终回答${facts.result?.resultStatus === 'unavailable' ? `：${facts.result.reason}` : '。'}`,
    ];
  }
  return (facts.result.finalAnswer ?? '[最终回答没有文本内容]')
    .split('\n')
    .map(line => `> ${line}`);
}

function renderHumanReview(benchmark: ResolvedBenchmarkCase): string[] {
  return [
    '> 以下部分必须由审核者查看数据库 current revision、最终诊断、全页渲染与必要的 PPTX 抽查后填写；运行 completed 不等于产物通过。',
    '',
    '### 产物硬事实',
    '',
    '| 项目 | 期望 | 实际 | 证据 |',
    '| --- | --- | --- | --- |',
    `| 产物 | ${escapeCell(benchmark.definition.artifactExpectation)} |  |  |`,
    '| Build / revision | current revision 可编译、无残留坏 draft |  |  |',
    '| 全页渲染 | 全部页面成功；error / overflow / 字体替换分栏记录 |  |  |',
    '| PPTX 抽查 | 导出成功，关键页面与 Linnya 预览接近 |  |  |',
    '',
    '### 质量评分',
    '',
    '| 维度 | 检查要点 | 评分（1–5） | 问题与证据 |',
    '| --- | --- | ---: | --- |',
    ...benchmark.definition.humanReview.map(criterion =>
      `| ${escapeCell(criterion.label)} | ${escapeCell(criterion.guidance)} |  |  |`,
    ),
    '',
    '### 逐页复核',
    '',
    '| 页码 | 页面职责 | 内容/事实 | 排版/可读性 | 图表/示意图 | 结论 |',
    '| ---: | --- | --- | --- | --- | --- |',
    '|  |  |  |  |  |  |',
    '',
    '### 问题分级与后续',
    '',
    '| 优先级 | 问题与根因 | 证据 | 建议归属 |',
    '| --- | --- | --- | --- |',
    '| P0 |  |  |  |',
    '| P1 |  |  |  |',
    '| P2 / P3 |  |  |  |',
    '',
    '### 人工结论',
    '',
    '- 是否通过：待审阅',
    '- 主要优点：',
    '- 最重要的三个问题：',
    '  1. ',
    '  2. ',
    '  3. ',
    '- 建议进入 Harness / 语法兼容 / Skill 的改进项：',
    '- 是否采纳为 baseline：否；需人工明确确认',
  ];
}

export function renderBenchmarkReport(
  benchmark: ResolvedBenchmarkCase,
  facts: BenchmarkRunFacts,
): string {
  const lines = [
    `# ${benchmark.definition.name}`,
    '',
    '> 本报告的运行事实由 Linnya CLI 自动采集；自动部分不生成质量总分，视觉与内容结论由人工复核填写。',
    '',
    '## 1. 管理层摘要',
    '',
    ...renderManagementSummary(facts),
    '',
    '## 2. 测试设计与运行身份',
    '',
    `- Case：\`${facts.benchmark.id}\` revision ${facts.benchmark.revision}`,
    `- 说明：${benchmark.definition.description}`,
    `- 标签：${facts.benchmark.tags.map(tag => `\`${tag}\``).join(' ')}`,
    `- Agent：\`${facts.configuration.agentId}\``,
    `- Model：${facts.configuration.modelId ? `\`${facts.configuration.modelId}\`` : '使用 App 默认路由'}`,
    `- Reasoning：\`${facts.configuration.reasoningEffort}\``,
    `- Case 预算：${formatDuration(facts.configuration.timeoutMs)}`,
    `- awaiting_user：${benchmark.definition.interaction.awaitingUser}，最多回应 ${benchmark.definition.interaction.maxResponses} 次；实际回应 ${facts.interactionResponses.length} 次。`,
    `- Conversation：${facts.receipt ? `\`${facts.receipt.conversation_id}\`` : '未创建'}`,
    `- Root run：${facts.receipt ? `\`${facts.receipt.run_id}\`` : '未创建'}`,
    '',
    '| 输入 | 值 |',
    '| --- | --- |',
    ...Object.entries(facts.configuration.inputs).map(
      ([key, value]) => `| ${escapeCell(key)} | ${escapeCell(value)} |`,
    ),
    '',
    '## 3. 阶段耗时与状态轨迹',
    '',
    ...renderPhaseTiming(facts),
    '',
    '### 状态轨迹',
    '',
    ...renderStatusTimeline(facts),
    '',
    '## 4. 审计来源与完整度',
    '',
    ...renderSourceCompleteness(facts),
    '',
    '## 5. Run 与 Agent 拓扑',
    '',
    ...renderRunTopology(facts),
    '',
    '## 6. LLM、Token 与缓存',
    '',
    ...renderLlmAudit(facts),
    '',
    '## 7. 自动上下文压缩',
    '',
    ...renderContextCompactionAudit(facts),
    '',
    '## 8. 工具执行',
    '',
    ...renderToolAudit(facts),
    '',
    '## 9. 错误、取消与恢复信号',
    '',
    ...renderFailures(facts),
    '',
    '## 10. Conversation 消息投影',
    '',
    ...renderMessageSummary(facts),
    '',
    '## 11. 最终回答',
    '',
    ...renderFinalAnswer(facts),
    '',
    '## 12. 人工产物审阅',
    '',
    ...renderHumanReview(benchmark),
    '',
  ];
  return lines.join('\n');
}
