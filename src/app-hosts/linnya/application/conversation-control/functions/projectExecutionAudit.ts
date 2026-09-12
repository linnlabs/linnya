import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlAuditResponse,
} from '@app/schemas';
import type {
  ExecutionAuditExport,
  ExecutionAuditUsage,
} from '../../execution-audit-export';

function projectTokens(tokens: ExecutionAuditExport['llm']['actualTokens']) {
  return {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    total_tokens_reported: tokens.totalTokensReported,
    reasoning_tokens_reported: tokens.reasoningTokensReported,
    cache_read_tokens_reported: tokens.cacheReadTokensReported,
    cache_write_tokens_reported: tokens.cacheWriteTokensReported,
  };
}

function projectUsage(usage: ExecutionAuditUsage | undefined) {
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens_reported: usage.totalTokens,
    reasoning_tokens_reported: usage.reasoningTokens,
    cache_read_tokens_reported: usage.cacheReadTokens,
    cache_write_tokens_reported: usage.cacheWriteTokens,
    confidence: usage.confidence,
  };
}

function projectCommandProcessExit(
  processExit: ExecutionAuditExport['commands']['byExecution'][number]['processExit'],
) {
  if (processExit.status === 'observed') {
    return {
      status: processExit.status,
      exit_code: processExit.exitCode,
      signal: processExit.signal,
    };
  }
  return processExit;
}

function projectCommandTerminal(
  command: ExecutionAuditExport['commands']['byExecution'][number],
): ConversationControlAuditResponse['commands']['by_execution'][number] {
  const common = {
    run_id: command.runId,
    tool_call_id: command.toolCallId,
    command_execution_id: command.commandExecutionId,
    terminal_observations: command.terminalObservations,
    process_exit: projectCommandProcessExit(command.processExit),
    emitted_at: command.emittedAt,
  };
  return command.outcome === 'execution_ended'
    ? {
        ...common,
        outcome: command.outcome,
        termination_cause: command.terminationCause,
      }
    : {
        ...common,
        outcome: command.outcome,
        runtime_failure_code: command.runtimeFailureCode,
      };
}

export function projectExecutionAuditResponse(input: {
  readonly conversationId: string;
  readonly requestedRunId?: string;
  readonly audit: ExecutionAuditExport;
}): ConversationControlAuditResponse {
  return {
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: true,
    command: 'audit',
    conversation_id: input.conversationId,
    requested_run_id: input.requestedRunId,
    generated_at: input.audit.generatedAt,
    completeness: {
      run_registry: 'complete',
      event_store: 'complete',
      telemetry: 'best_effort',
      telemetry_retention_days: 7,
    },
    source_window: {
      telemetry_events: input.audit.sourceWindow.telemetryEvents,
      event_facts: input.audit.sourceWindow.eventFacts,
      earliest_telemetry_at: input.audit.sourceWindow.earliestTelemetryAt,
      latest_telemetry_at: input.audit.sourceWindow.latestTelemetryAt,
    },
    runs: input.audit.runs.map(run => ({
      run_id: run.runId,
      parent_run_id: run.parentRunId,
      agent_id: run.agentSpecId,
      status: run.status,
      started_at: run.startedAt,
      updated_at: run.updatedAt,
      execution_steps_used: run.executionStepsUsed,
      run_iterations_used: run.runIterationsUsed ?? run.iterationsUsed,
      iterations_used: run.runIterationsUsed ?? run.iterationsUsed,
      error_code: run.errorCode,
    })),
    llm: {
      calls: input.audit.llm.calls,
      duration_ms: input.audit.llm.durationMs,
      provider_actual_calls: input.audit.llm.providerActualCalls,
      estimate_calls: input.audit.llm.estimateCalls,
      missing_usage_calls: input.audit.llm.missingUsageCalls,
      actual_tokens: projectTokens(input.audit.llm.actualTokens),
      by_model: input.audit.llm.byModel.map(model => ({
        model_id: model.modelId,
        calls: model.calls,
        duration_ms: model.durationMs,
        provider_actual_calls: model.providerActualCalls,
        estimate_calls: model.estimateCalls,
        missing_usage_calls: model.missingUsageCalls,
        actual_tokens: projectTokens(model.actualTokens),
      })),
    },
    tools: {
      calls: input.audit.tools.calls,
      failed_calls: input.audit.tools.failedCalls,
      duration_ms: input.audit.tools.durationMs,
      by_tool: input.audit.tools.byTool.map(tool => ({
        tool_name: tool.toolName,
        calls: tool.calls,
        failed_calls: tool.failedCalls,
        duration_ms: tool.durationMs,
        error_codes: [...tool.errorCodes],
      })),
    },
    tool_pairing: {
      complete: input.audit.toolPairing.complete,
      paired: input.audit.toolPairing.paired,
      decision_missing: input.audit.toolPairing.decisionMissing,
      terminal_missing: input.audit.toolPairing.terminalMissing,
      duplicate_terminal: input.audit.toolPairing.duplicateTerminal,
      name_mismatches: input.audit.toolPairing.nameMismatches,
      records: input.audit.toolPairing.records.map(record => ({
        run_id: record.runId,
        parent_run_id: record.parentRunId,
        tool_call_id: record.toolCallId,
        tool_name: record.toolName,
        pairing_status: record.pairingStatus,
        decision_count: record.decisionCount,
        terminal_count: record.terminalCount,
        terminal_status: record.terminalStatus,
        name_consistent: record.nameConsistent,
      })),
    },
    commands: {
      executions: input.audit.commands.executions,
      terminal_observations: input.audit.commands.terminalObservations,
      nonzero_exit_executions: input.audit.commands.nonZeroExitExecutions,
      runtime_failure_executions: input.audit.commands.runtimeFailureExecutions,
      by_execution: input.audit.commands.byExecution.map(projectCommandTerminal),
    },
    workspace_documents: {
      observations: input.audit.workspaceDocuments.observations,
      observations_with_errors: input.audit.workspaceDocuments.observationsWithErrors,
      observations_with_warnings: input.audit.workspaceDocuments.observationsWithWarnings,
      visible: input.audit.workspaceDocuments.visible,
      truncated_count: input.audit.workspaceDocuments.truncatedCount,
      by_observation: input.audit.workspaceDocuments.byObservation.map(observation => ({
        run_id: observation.runId,
        parent_run_id: observation.parentRunId,
        tool_call_id: observation.toolCallId,
        tool_name: observation.toolName,
        emitted_at: observation.emittedAt,
        visible: observation.visible,
        truncated_count: observation.truncatedCount,
      })),
    },
    context_compaction: {
      observations: input.audit.contextCompaction.observations,
      attempts: input.audit.contextCompaction.attempts,
      completed: input.audit.contextCompaction.completed,
      failed: input.audit.contextCompaction.failed,
      insufficient: input.audit.contextCompaction.insufficient,
      aborted: input.audit.contextCompaction.aborted,
      skipped: input.audit.contextCompaction.skipped,
      duration_ms: input.audit.contextCompaction.durationMs,
      compaction_input_tokens_reported:
        input.audit.contextCompaction.compactionInputTokensReported,
      summary_output_tokens_reported:
        input.audit.contextCompaction.summaryOutputTokensReported,
      released_tokens_reported: input.audit.contextCompaction.releasedTokensReported,
      provider_actual_calls: input.audit.contextCompaction.providerActualCalls,
      estimate_calls: input.audit.contextCompaction.estimateCalls,
      missing_usage_calls: input.audit.contextCompaction.missingUsageCalls,
      actual_tokens: projectTokens(input.audit.contextCompaction.actualTokens),
      by_run: input.audit.contextCompaction.byRun.map(run => ({
        run_id: run.runId,
        parent_run_id: run.parentRunId,
        observations: run.observations,
        attempts: run.attempts,
        completed: run.completed,
        failed: run.failed,
        insufficient: run.insufficient,
        aborted: run.aborted,
        skipped: run.skipped,
        duration_ms: run.durationMs,
        max_compactions_per_run: run.maxCompactionsPerRun,
        compaction_input_tokens_reported: run.compactionInputTokensReported,
        summary_output_tokens_reported: run.summaryOutputTokensReported,
        released_tokens_reported: run.releasedTokensReported,
        provider_actual_calls: run.providerActualCalls,
        estimate_calls: run.estimateCalls,
        missing_usage_calls: run.missingUsageCalls,
        actual_tokens: projectTokens(run.actualTokens),
        events: run.events.map(event => ({
          emitted_at: event.emittedAt,
          model_id: event.modelId,
          compaction_index: event.compactionIndex,
          max_compactions_per_run: event.maxCompactionsPerRun,
          generation_attempted: event.generationAttempted,
          trigger_ratio: event.triggerRatio,
          target_ratio: event.targetRatio,
          before_tokens: event.beforeTokens,
          input_budget_tokens: event.inputBudgetTokens,
          compaction_input_tokens: event.compactionInputTokens,
          after_tokens: event.afterTokens,
          replaced_message_count: event.replacedMessageCount,
          replaced_tool_group_count: event.replacedToolGroupCount,
          kept_tool_group_count: event.keptToolGroupCount,
          summary_output_tokens: event.summaryOutputTokens,
          compression_ratio: event.compressionRatio,
          usage: projectUsage(event.usage),
          duration_ms: event.durationMs,
          outcome: event.outcome,
          suppressed_reason: event.suppressedReason,
          forced_phase_recovery: event.forcedPhaseRecovery,
          target_unreachable: event.targetUnreachable,
          error_code: event.errorCode,
          failure_reason: event.failureReason,
        })),
      })),
    },
    run_lifecycle: {
      by_run: input.audit.runLifecycle.byRun.map(run => ({
        run_id: run.runId,
        parent_run_id: run.parentRunId,
        terminal_observations: run.terminalObservations,
        phase: run.phase,
        steps_used: run.stepsUsed,
        max_steps: run.maxSteps,
        terminal_reason: run.terminalReason,
        emitted_at: run.emittedAt,
      })),
    },
  };
}
