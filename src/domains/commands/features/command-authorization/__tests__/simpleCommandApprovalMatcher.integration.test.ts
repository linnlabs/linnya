import {
  CommandApprovalRequestIdSchema,
  CommandConversationApprovalCandidateSchema,
  CommandConversationIdSchema,
  type CommandConversationApprovalCandidate,
} from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import {
  ConversationCommandApprovalSchema,
  type ConversationCommandApproval,
} from '../../../definitions/commandApproval';
import {
  COMMAND_AUTHORIZATION_MATCHER_REVISION,
} from '../definitions/simpleCommand';
import { deriveSimpleCommandCandidate } from '../functions/deriveSimpleCommandCandidate';
import { matchConversationCommandApproval } from '../functions/matchConversationCommandApproval';

const MACOS_CONTEXT = {
  platform: 'macos' as const,
  shell_semantics_id: 'zsh',
  matcher_revision: COMMAND_AUTHORIZATION_MATCHER_REVISION,
};
const CONVERSATION_ID = CommandConversationIdSchema.parse('conversation-simple-command');

function candidate(params: {
  readonly tokens: readonly string[];
  readonly platform?: 'macos' | 'windows';
  readonly shellSemanticsId?: string;
  readonly matcherRevision?: string;
}): CommandConversationApprovalCandidate {
  return CommandConversationApprovalCandidateSchema.parse({
    token_prefix: params.tokens,
    matching_context: {
      platform: params.platform ?? 'macos',
      shell_semantics_id: params.shellSemanticsId ?? 'zsh',
      matcher_revision: params.matcherRevision ?? COMMAND_AUTHORIZATION_MATCHER_REVISION,
    },
  });
}

function approval(params: {
  readonly requestSuffix: string;
  readonly tokens: readonly string[];
  readonly approvedAtMs: number;
  readonly platform?: 'macos' | 'windows';
  readonly shellSemanticsId?: string;
  readonly matcherRevision?: string;
  readonly conversationId?: string;
}): ConversationCommandApproval {
  return ConversationCommandApprovalSchema.parse({
    approvalRequestId: CommandApprovalRequestIdSchema.parse(
      `command_approval_00000000-0000-4000-8000-${params.requestSuffix.padStart(12, '0')}`,
    ),
    conversationId: CommandConversationIdSchema.parse(
      params.conversationId ?? CONVERSATION_ID,
    ),
    candidate: candidate(params),
    approvedCwd: '/tmp/linnya-simple-command',
    approvedAtMs: params.approvedAtMs,
  });
}

describe('simple command conversation approval matcher', () => {
  it('derives stable zsh tokens from static quoting, empty arguments and escapes', () => {
    const result = deriveSimpleCommandCandidate({
      command: String.raw`printf '%s\n' "hello world" '' escaped\ path 中文`,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    });

    expect(result).toEqual({
      status: 'derived',
      candidate: {
        token_prefix: ['printf', String.raw`%s\n`, 'hello world', '', 'escaped path', '中文'],
        matching_context: MACOS_CONTEXT,
      },
    });
  });

  it('derives stable PowerShell tokens without normalizing case or paths', () => {
    const result = deriveSimpleCommandCandidate({
      command: "Write-Output 'hello world' \"\" 'it''s' escaped\\path hello` world \"a\"\"b\"",
      platform: 'windows',
      shellSemanticsId: 'powershell-5.1',
    });

    expect(result).toEqual({
      status: 'derived',
      candidate: {
        token_prefix: [
          'Write-Output',
          'hello world',
          '',
          "it's",
          String.raw`escaped\path`,
          'hello world',
          'a"b',
        ],
        matching_context: {
          platform: 'windows',
          shell_semantics_id: 'powershell-5.1',
          matcher_revision: COMMAND_AUTHORIZATION_MATCHER_REVISION,
        },
      },
    });
  });

  it('keeps quoted operator and expansion characters literal on both Shell families', () => {
    expect(deriveSimpleCommandCandidate({
      command: String.raw`printf '%s' '$HOME' '*' ';' '#text'`,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toMatchObject({
      status: 'derived',
      candidate: { token_prefix: ['printf', '%s', '$HOME', '*', ';', '#text'] },
    });

    expect(deriveSimpleCommandCandidate({
      command: "Write-Output '$env:TEMP' '|' '*' '#text'",
      platform: 'windows',
      shellSemanticsId: 'powershell-7',
    })).toMatchObject({
      status: 'derived',
      candidate: { token_prefix: ['Write-Output', '$env:TEMP', '|', '*', '#text'] },
    });
  });

  it.each([
    ['pipeline', 'git status | cat'],
    ['redirection', 'printf ok > result.txt'],
    ['and-list', 'cd work && ls'],
    ['or-list', 'test -f file || touch file'],
    ['separator', 'pwd; ls'],
    ['variable expansion', 'printf %s $HOME'],
    ['command substitution', 'printf %s $(date)'],
    ['legacy command substitution', 'printf %s `date`'],
    ['subshell', '(git status)'],
    ['heredoc', 'cat <<EOF'],
    ['environment prefix', 'MODE=test tool run'],
    ['append environment prefix', 'PATH+=:/tool tool run'],
    ['glob expansion', 'printf %s *.txt'],
    ['zsh command-path expansion', 'printf %s =git'],
    ['multiple lines', 'pwd\nls'],
    ['ambiguous Unicode whitespace', 'tool\u00a0argument'],
  ])('keeps zsh %s commands one-time-only', (_label, command) => {
    expect(deriveSimpleCommandCandidate({
      command,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toMatchObject({ status: 'one_time_only' });
  });

  it.each([
    ['pipeline', 'Get-ChildItem | Select-Object Name'],
    ['redirection', 'Write-Output ok > result.txt'],
    ['separator', 'Get-Date; Get-Location'],
    ['variable expansion', 'Write-Output $env:TEMP'],
    ['subexpression', 'Write-Output $(Get-Date)'],
    ['call operator', '& tool.exe'],
    ['script block', '{ Get-Date }'],
    ['array expression', '@(1, 2)'],
    ['glob expansion', 'Get-ChildItem *.txt'],
    ['here-string', '@"text"@'],
    ['stop-parsing token', 'tool.exe --% literal'],
    ['PowerShell 7 Unicode escape', 'Write-Output "a`u{20}b"'],
    ['smart double quotes', 'Write-Output “hello world”'],
    ['smart single quotes', 'Write-Output ‘hello world’'],
    ['multiple lines', 'Get-Date\r\nGet-Location'],
    ['ambiguous Unicode whitespace', 'tool.exe\u00a0argument'],
  ])('keeps PowerShell %s commands one-time-only', (_label, command) => {
    expect(deriveSimpleCommandCandidate({
      command,
      platform: 'windows',
      shellSemanticsId: 'powershell-7',
    })).toMatchObject({ status: 'one_time_only' });
  });

  it.each([
    ['macos', 'zsh', "printf 'unterminated"],
    ['macos', 'zsh', 'printf trailing\\'],
    ['windows', 'powershell-5.1', 'Write-Output "unterminated'],
    ['windows', 'powershell-5.1', 'Write-Output trailing`'],
  ] as const)('does not remember malformed %s command text', (platform, shellSemanticsId, command) => {
    expect(deriveSimpleCommandCandidate({
      command,
      platform,
      shellSemanticsId,
    })).toEqual({ status: 'one_time_only', reason: 'malformed_command' });
  });

  it.each([
    ['macos', 'zsh', 'python3 -c print'],
    ['macos', 'zsh', String.raw`python3 -cprint\(123\)`],
    ['macos', 'zsh', String.raw`perl -eprint\ 789`],
    ['macos', 'zsh', String.raw`ruby -eputs\ 321`],
    ['macos', 'zsh', String.raw`node --eval=console.log\(456\)`],
    ['macos', 'zsh', String.raw`bun -econsole.log\(123\)`],
    ['macos', 'zsh', 'bun -p1+2'],
    ['macos', 'zsh', '/bin/bash -lc script'],
    ['macos', 'zsh', '/opt/homebrew/bin/python3.13 -c print'],
    ['macos', 'zsh', 'sudo tool'],
    ['macos', 'zsh', 'repeat 2 tool'],
    ['macos', 'zsh', 'noglob tool literal'],
    ['macos', 'zsh', 'nocorrect tool argument'],
    ['macos', 'zsh', 'coproc tool argument'],
    ['macos', 'zsh', '- python3 -c print'],
    ['macos', 'zsh', 'nohup python3 -c print'],
    ['macos', 'zsh', 'nice python3 -c print'],
    ['macos', 'zsh', 'arch python3 -c print'],
    ['windows', 'powershell-5.1', 'pwsh -Command script'],
    ['windows', 'powershell-5.1', 'cmd /cdir'],
    ['windows', 'powershell-5.1', 'py -c print'],
    ['windows', 'powershell-5.1', 'pyw -cpass'],
    ['windows', 'powershell-7', 'Invoke-Expression command.txt'],
    ['windows', 'powershell-7', "iex 'Write-Output hi'"],
    ['windows', 'powershell-7', 'icm localhost command'],
    ['windows', 'powershell-7', 'saps tool.exe'],
    ['windows', 'powershell-7', 'start tool.exe'],
    ['windows', 'powershell-7', 'sajb command'],
    ['windows', 'powershell-7', 'C:\\Python313\\python.exe -c print'],
    ['windows', 'powershell-7', 'C:\\Windows\\py.exe -c print'],
    ['windows', 'powershell-7', 'pythonw.exe -cpass'],
    ['windows', 'powershell-7', 'Start-Process tool.exe'],
    ['windows', 'powershell-7', 'wsl.exe tool argument'],
  ] as const)('does not create a broad memory rule for %s dynamic command', (
    platform,
    shellSemanticsId,
    command,
  ) => {
    expect(deriveSimpleCommandCandidate({
      command,
      platform,
      shellSemanticsId,
    })).toEqual({ status: 'one_time_only', reason: 'unsafe_prefix' });
  });

  it.each([
    ['macos', 'zsh', 'python3 script.py'],
    ['macos', 'zsh', '/bin/bash script.sh'],
    ['macos', 'zsh', '/opt/homebrew/bin/python3.13 script.py'],
    ['macos', 'zsh', 'npm run build'],
    ['windows', 'powershell-5.1', 'pwsh -File script.ps1'],
    ['windows', 'powershell-5.1', 'py script.py'],
    ['windows', 'powershell-7', 'C:\\Python313\\python.exe script.py'],
    ['windows', 'powershell-7', 'C:\\Tools\\npm.cmd run build'],
  ] as const)('keeps a static %s CLI invocation eligible', (
    platform,
    shellSemanticsId,
    command,
  ) => {
    expect(deriveSimpleCommandCandidate({
      command,
      platform,
      shellSemanticsId,
    })).toMatchObject({ status: 'derived' });
  });

  it('does not turn a single token into executable-only conversation approval', () => {
    expect(deriveSimpleCommandCandidate({
      command: 'git',
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toEqual({ status: 'one_time_only', reason: 'unsafe_prefix' });
  });

  it('keeps a static command outside the wire token budget one-time-only', () => {
    const command = ['tool', ...Array.from({ length: 32 }, (_, index) => `arg-${index}`)].join(' ');

    expect(deriveSimpleCommandCandidate({
      command,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toEqual({ status: 'one_time_only', reason: 'candidate_too_large' });
  });

  it('keeps exactly 32 static tokens eligible', () => {
    const command = ['tool', ...Array.from({ length: 31 }, (_, index) => `arg-${index}`)].join(' ');

    expect(deriveSimpleCommandCandidate({
      command,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toMatchObject({ status: 'derived' });
  });

  it('uses the shared Unicode character budget throughout candidate derivation', () => {
    const withinBudget = `tool ${'😀'.repeat(6_001)}`;
    expect(deriveSimpleCommandCandidate({
      command: withinBudget,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toMatchObject({ status: 'derived' });

    const outsideBudget = `tool ${'😀'.repeat(11_996)}`;
    expect(deriveSimpleCommandCandidate({
      command: outsideBudget,
      platform: 'macos',
      shellSemanticsId: 'zsh',
    })).toEqual({ status: 'one_time_only', reason: 'candidate_too_large' });
  });

  it('fails closed when the host requests an unsupported frozen Shell semantics', () => {
    expect(deriveSimpleCommandCandidate({
      command: 'git status',
      platform: 'windows',
      shellSemanticsId: 'cmd.exe',
    })).toEqual({ status: 'unavailable', reason: 'unsupported_shell_semantics' });
  });

  it('matches only on token boundaries and permits later tokens after the visible prefix', () => {
    const remembered = approval({
      requestSuffix: '1',
      tokens: ['git', 'status'],
      approvedAtMs: 100,
    });

    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({ tokens: ['git', 'status', '--short'] }),
      approvals: [remembered],
    })).toEqual({ status: 'matched', approval: remembered });

    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({ tokens: ['git-malicious', 'status'] }),
      approvals: [approval({
        requestSuffix: '2',
        tokens: ['git'],
        approvedAtMs: 200,
      })],
    })).toEqual({ status: 'unavailable', reason: 'invalid_stored_approval' });
  });

  it('matches equivalent static quoting after both commands are tokenized', () => {
    const rememberedCandidate = deriveSimpleCommandCandidate({
      command: "tool 'hello world'",
      platform: 'macos',
      shellSemanticsId: 'zsh',
    });
    const currentCandidate = deriveSimpleCommandCandidate({
      command: 'tool hello\\ world',
      platform: 'macos',
      shellSemanticsId: 'zsh',
    });
    expect(rememberedCandidate.status).toBe('derived');
    expect(currentCandidate.status).toBe('derived');
    if (rememberedCandidate.status !== 'derived' || currentCandidate.status !== 'derived') {
      throw new Error('static quoting corpus must remain eligible for conversation approval');
    }
    const remembered = approval({
      requestSuffix: '4',
      tokens: rememberedCandidate.candidate.token_prefix,
      approvedAtMs: 400,
    });

    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: currentCandidate.candidate,
      approvals: [remembered],
    })).toEqual({ status: 'matched', approval: remembered });
  });

  it('does not let a longer remembered command approve a shorter command', () => {
    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({ tokens: ['git', 'status'] }),
      approvals: [approval({
        requestSuffix: '1',
        tokens: ['git', 'status', '--short'],
        approvedAtMs: 100,
      })],
    })).toEqual({ status: 'not_matched' });
  });

  it('does not trust an approval loaded for another conversation', () => {
    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({ tokens: ['git', 'status'] }),
      approvals: [approval({
        requestSuffix: '9',
        tokens: ['git', 'status'],
        approvedAtMs: 900,
        conversationId: 'another-conversation',
      })],
    })).toEqual({ status: 'not_matched' });
  });

  it.each([
    candidate({ tokens: ['git', 'status'], platform: 'windows', shellSemanticsId: 'powershell-7' }),
    candidate({ tokens: ['git', 'status'], shellSemanticsId: 'future-zsh' }),
    candidate({ tokens: ['git', 'status'], matcherRevision: 'command-authorization-v1' }),
  ])('does not reuse an approval from a different matching context', current => {
    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: current,
      approvals: [approval({
        requestSuffix: '1',
        tokens: ['git', 'status'],
        approvedAtMs: 100,
      })],
    })).not.toMatchObject({ status: 'matched' });
  });

  it('selects the most specific and newest matching approval independent of storage order', () => {
    const broad = approval({ requestSuffix: '1', tokens: ['git', 'status'], approvedAtMs: 300 });
    const olderSpecific = approval({
      requestSuffix: '2',
      tokens: ['git', 'status', '--short'],
      approvedAtMs: 100,
    });
    const newestSpecific = approval({
      requestSuffix: '3',
      tokens: ['git', 'status', '--short'],
      approvedAtMs: 200,
    });
    const current = candidate({ tokens: ['git', 'status', '--short', '--branch'] });

    for (const approvals of [
      [broad, newestSpecific, olderSpecific],
      [olderSpecific, broad, newestSpecific],
    ]) {
      expect(matchConversationCommandApproval({
        conversationId: CONVERSATION_ID,
        candidate: current,
        approvals,
      }))
        .toEqual({ status: 'matched', approval: newestSpecific });
    }
  });

  it('fails closed instead of reinterpreting a current candidate from another matcher revision', () => {
    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({
        tokens: ['git', 'status'],
        matcherRevision: 'command-authorization-v3',
      }),
      approvals: [],
    })).toEqual({ status: 'unavailable', reason: 'unsupported_matcher_context' });
  });

  it('fails closed on a schema-valid executable-only current candidate', () => {
    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({ tokens: ['git'] }),
      approvals: [],
    })).toEqual({ status: 'unavailable', reason: 'invalid_current_candidate' });
  });

  it.each([
    ['python3', '-cprint(123)'],
    ['py.exe', '-cprint(123)'],
  ])('does not restore authorization from a schema-valid legacy %s dynamic prefix', (
    executable,
    dynamicArgument,
  ) => {
    expect(matchConversationCommandApproval({
      conversationId: CONVERSATION_ID,
      candidate: candidate({ tokens: [executable, 'script.py'] }),
      approvals: [approval({
        requestSuffix: '8',
        tokens: [executable, dynamicArgument],
        approvedAtMs: 800,
      })],
    })).toEqual({ status: 'unavailable', reason: 'invalid_stored_approval' });
  });
});
