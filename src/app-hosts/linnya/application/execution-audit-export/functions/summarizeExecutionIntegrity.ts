import type {
  ExecutionAuditCommandTerminalSummary,
  ExecutionAuditEventFact,
  ExecutionAuditExport,
  ExecutionAuditToolPairingRecord,
  ExecutionAuditToolPairingStatus,
} from '../definitions/executionAuditExport';

interface MutableToolPairing {
  runId: string;
  parentRunId?: string;
  toolCallId: string;
  names: Set<string>;
  decisions: number;
  terminals: Array<Extract<ExecutionAuditEventFact, { kind: 'tool_terminal' }>>;
}

function pairingStatus(pairing: MutableToolPairing): ExecutionAuditToolPairingStatus {
  if (pairing.terminals.length > 1) return 'duplicate_terminal';
  if (pairing.decisions === 0) return 'decision_missing';
  if (pairing.terminals.length === 0) return 'terminal_missing';
  return 'paired';
}

function summarizeToolPairing(
  facts: readonly ExecutionAuditEventFact[],
): ExecutionAuditExport['toolPairing'] {
  const byIdentity = new Map<string, MutableToolPairing>();
  for (const fact of facts) {
    if (fact.kind === 'command_terminal') continue;
    const identity = `${fact.runId}\u0000${fact.toolCallId}`;
    const pairing = byIdentity.get(identity) ?? {
      runId: fact.runId,
      ...(fact.parentRunId ? { parentRunId: fact.parentRunId } : {}),
      toolCallId: fact.toolCallId,
      names: new Set<string>(),
      decisions: 0,
      terminals: [],
    };
    if (!pairing.parentRunId && fact.parentRunId) pairing.parentRunId = fact.parentRunId;
    pairing.names.add(fact.toolName);
    if (fact.kind === 'tool_decision') pairing.decisions += 1;
    if (fact.kind === 'tool_terminal') pairing.terminals.push(fact);
    byIdentity.set(identity, pairing);
  }

  const records: ExecutionAuditToolPairingRecord[] = [...byIdentity.values()]
    .map(pairing => {
      const names = [...pairing.names].sort();
      const terminal = [...pairing.terminals].sort(
        (left, right) => left.emittedAt - right.emittedAt,
      )[pairing.terminals.length - 1];
      return {
        runId: pairing.runId,
        ...(pairing.parentRunId ? { parentRunId: pairing.parentRunId } : {}),
        toolCallId: pairing.toolCallId,
        toolName: names[0] ?? 'unknown',
        pairingStatus: pairingStatus(pairing),
        decisionCount: pairing.decisions,
        terminalCount: pairing.terminals.length,
        ...(terminal ? { terminalStatus: terminal.status } : {}),
        nameConsistent: names.length === 1,
      };
    })
    .sort((left, right) => (
      left.runId.localeCompare(right.runId)
      || left.toolCallId.localeCompare(right.toolCallId)
    ));

  const count = (status: ExecutionAuditToolPairingStatus): number => (
    records.filter(record => record.pairingStatus === status).length
  );
  const nameMismatches = records.filter(record => !record.nameConsistent).length;
  const decisionMissing = count('decision_missing');
  const terminalMissing = count('terminal_missing');
  const duplicateTerminal = count('duplicate_terminal');
  return {
    complete: decisionMissing === 0
      && terminalMissing === 0
      && duplicateTerminal === 0
      && nameMismatches === 0,
    paired: count('paired'),
    decisionMissing,
    terminalMissing,
    duplicateTerminal,
    nameMismatches,
    records,
  };
}

function summarizeCommands(
  facts: readonly ExecutionAuditEventFact[],
): ExecutionAuditExport['commands'] {
  const byExecution = new Map<string, ExecutionAuditCommandTerminalSummary>();
  const observations = new Map<string, number>();
  for (const fact of facts) {
    if (fact.kind !== 'command_terminal') continue;
    const terminalObservations = (observations.get(fact.commandExecutionId) ?? 0) + 1;
    observations.set(fact.commandExecutionId, terminalObservations);
    const previous = byExecution.get(fact.commandExecutionId);
    if (previous && previous.emittedAt > fact.emittedAt) {
      byExecution.set(fact.commandExecutionId, { ...previous, terminalObservations });
      continue;
    }
    byExecution.set(fact.commandExecutionId, {
      runId: fact.runId,
      toolCallId: fact.toolCallId,
      commandExecutionId: fact.commandExecutionId,
      terminalObservations,
      ...(fact.outcome === 'execution_ended'
        ? { outcome: fact.outcome, terminationCause: fact.terminationCause }
        : { outcome: fact.outcome, runtimeFailureCode: fact.runtimeFailureCode }),
      processExit: fact.processExit,
      emittedAt: fact.emittedAt,
    });
  }
  const summaries = [...byExecution.values()].sort(
    (left, right) => left.commandExecutionId.localeCompare(right.commandExecutionId),
  );
  return {
    executions: summaries.length,
    terminalObservations: [...observations.values()].reduce((sum, count) => sum + count, 0),
    nonZeroExitExecutions: summaries.filter(summary => (
      summary.processExit.status === 'observed'
      && summary.processExit.exitCode !== null
      && summary.processExit.exitCode !== 0
    )).length,
    runtimeFailureExecutions: summaries.filter(summary => summary.outcome === 'runtime_failure').length,
    byExecution: summaries,
  };
}

export function summarizeExecutionIntegrity(
  facts: readonly ExecutionAuditEventFact[],
): Pick<ExecutionAuditExport, 'toolPairing' | 'commands'> {
  return {
    toolPairing: summarizeToolPairing(facts),
    commands: summarizeCommands(facts),
  };
}
