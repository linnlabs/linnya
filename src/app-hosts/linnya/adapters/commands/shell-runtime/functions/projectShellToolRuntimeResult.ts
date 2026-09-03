import type {
  CommandOutputIncompleteReason,
  CommandExecutionTerminalV1,
  CommandToolOutputDisplay,
  CommandOutputStore,
} from '@app/schemas/commands';
import type {
  CommandSettledTextOutput,
  CommandSettledTextResource,
  ProcessOutputObservationWindow,
} from '../../../../../../domains/commands';
import type {
  ShellToolTerminalSummary,
} from '../definitions';

type CommandOutputStoreResource = Extract<
  CommandOutputStore,
  { readonly mode: 'pipe' }
>['stdout'];

function exitFact(terminal: CommandExecutionTerminalV1): {
  readonly exitCode: number | null;
  readonly signal: string | null;
} {
  return terminal.process_exit.status === 'observed'
    ? {
        exitCode: terminal.process_exit.exit_code,
        signal: terminal.process_exit.signal,
      }
    : { exitCode: null, signal: null };
}

export function projectShellToolTerminal(
  terminal: CommandExecutionTerminalV1,
): ShellToolTerminalSummary {
  if (terminal.outcome === 'runtime_failure') {
    return { outcome: 'runtime_failure', code: terminal.failure.code };
  }
  const observedExit = exitFact(terminal);
  if (terminal.termination_cause === 'natural_exit') {
    return { outcome: 'exited', ...observedExit };
  }
  return {
    outcome: 'terminated',
    reason: terminal.termination_cause === 'user_cancelled'
      ? 'cancelled'
      : terminal.termination_cause === 'hard_timeout'
        ? 'timed_out'
        : 'owner_ended',
    ...observedExit,
  };
}

function projectSettledTextResource(
  resource: CommandSettledTextResource,
): CommandOutputStoreResource {
  if (resource.status === 'published') {
    return {
      status: 'published',
      completeness: resource.completeness,
      blob_id: resource.blobId,
      persisted_characters: resource.persistedCharacters,
      persisted_lines: resource.persistedLines,
    };
  }
  return resource.status === 'not_created'
    ? { status: 'not_created', reason: resource.reason }
    : { status: 'unavailable' };
}

export function projectCommandOutputStore(
  output: CommandSettledTextOutput,
): CommandOutputStore {
  return output.mode === 'pipe'
    ? {
        mode: 'pipe',
        stdout: projectSettledTextResource(output.stdout),
        stderr: projectSettledTextResource(output.stderr),
      }
    : {
        mode: 'pty',
        terminal: projectSettledTextResource(output.terminal),
      };
}

/** Agent 只看稳定纯文本；cursor/coverage 继续由结构化字段表达，不塞进正文。 */
export function projectProcessObservationText(
  observation: ProcessOutputObservationWindow,
): string {
  let projected: string;
  if (observation.mode === 'pty') {
    if (!observation.terminal) return '(no output)';
    projected = observation.terminal.status === 'complete'
      ? `terminal:\n${observation.terminal.text}`
      : [
          'terminal:',
          observation.terminal.head,
          `[${observation.terminal.omitted_chars} characters omitted]`,
          observation.terminal.tail,
        ].join('\n');
  } else {
    const stdoutCurrent = observation.currentLogicalLines.stdout.text;
    const stderrCurrent = observation.currentLogicalLines.stderr.text;
    const stdout = `${observation.stdout}${stdoutCurrent}`;
    const stderr = `${observation.stderr}${stderrCurrent}`;
    const sections = [
      ...(stdout.length > 0 ? [`stdout:\n${stdout}`] : []),
      ...(stderr.length > 0 ? [`stderr:\n${stderr}`] : []),
    ];
    projected = sections.length > 0 ? sections.join('\n') : '(no output)';
  }

  // AgentEvent 的 observation 合同禁止边界空白；这里只规范化 Agent 文本投影，
  // raw stdout/stderr 仍由 ToolOutputStore 保留原样，避免把证据层和模型视图混在一起。
  return projected.trim();
}

/**
 * UI display 与 Agent observation 同源但不混用：pipe 只需要稳定纯文本，PTY 才携带
 * host 已解释的稀疏屏幕。这里绝不把 raw transcript 或 ANSI 控制序列交给 renderer。
 */
export function projectProcessObservationDisplay(
  observation: ProcessOutputObservationWindow,
): CommandToolOutputDisplay {
  const incompleteReasons: CommandOutputIncompleteReason[] = [];
  if (observation.coverage === 'omitted') {
    incompleteReasons.push('retained_window_omitted');
  }
  if (observation.textProjection === 'failed') {
    incompleteReasons.push('text_projection_failed');
  }
  return observation.mode === 'pipe'
    ? {
        mode: 'pipe',
        coverage: observation.coverage,
        outputPhase: observation.outputPhase,
        textProjection: observation.textProjection,
        incompleteReasons,
      }
    : {
        mode: 'pty',
        coverage: observation.coverage,
        outputPhase: observation.outputPhase,
        textProjection: observation.textProjection,
        incompleteReasons,
        ...(observation.screen ? { screen: observation.screen } : {}),
      };
}
