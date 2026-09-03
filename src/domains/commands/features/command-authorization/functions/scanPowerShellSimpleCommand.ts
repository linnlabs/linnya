import type { StaticCommandScanResult } from '../definitions/simpleCommand';

type QuoteMode = 'unquoted' | 'single' | 'double';

const POWERSHELL_DYNAMIC_OR_CONTROL_CHARACTERS = new Set([
  '|', '&', ';', '<', '>', '(', ')', '{', '}', '[', ']', '$', '@', ',', '\n', '\r',
]);
const POWERSHELL_UNQUOTED_EXPANSION_CHARACTERS = new Set(['*', '?', '#']);
const POWERSHELL_STATIC_ESCAPES = new Set([
  ' ', '\t', '"', "'", '`', '$', '|', '&', ';', '<', '>', '(', ')', '{', '}', '[', ']',
  '@', ',', '*', '?', '#', '\\',
]);
const POWERSHELL_SMART_QUOTES = new Set(['\u2018', '\u2019', '\u201c', '\u201d']);

function oneTime(
  reason: 'complex_or_dynamic' | 'malformed_command',
): StaticCommandScanResult {
  return { status: 'one_time_only', reason };
}

/**
 * PowerShell 的完整 AST 很强也很重；批准前启动 PowerShell 本身又违反“先批准、后 spawn”。
 * 因此这里只识别静态单命令，脚本块、变量、数组、管道和重定向都只允许本次。
 */
export function scanPowerShellSimpleCommand(command: string): StaticCommandScanResult {
  if (command.length === 0 || command.includes('\0')) {
    return oneTime('malformed_command');
  }

  const tokens: string[] = [];
  let token = '';
  let tokenStarted = false;
  let mode: QuoteMode = 'unquoted';

  const finishToken = (): void => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = '';
    tokenStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (character === '\n' || character === '\r') {
      return oneTime('complex_or_dynamic');
    }
    if (POWERSHELL_SMART_QUOTES.has(character)) {
      return oneTime('complex_or_dynamic');
    }

    if (mode === 'single') {
      if (character === "'" && command[index + 1] === "'") {
        token += "'";
        index += 1;
      } else if (character === "'") {
        mode = 'unquoted';
      } else {
        token += character;
      }
      continue;
    }

    if (mode === 'double') {
      if (character === '"') {
        if (command[index + 1] === '"') {
          token += '"';
          index += 1;
          continue;
        }
        mode = 'unquoted';
        continue;
      }
      if (character === '$') return oneTime('complex_or_dynamic');
      if (character === '`') {
        const next = command[index + 1];
        if (next === undefined) return oneTime('malformed_command');
        if (!POWERSHELL_STATIC_ESCAPES.has(next)) {
          return oneTime('complex_or_dynamic');
        }
        token += next;
        index += 1;
        continue;
      }
      token += character;
      continue;
    }

    if (character === ' ' || character === '\t') {
      finishToken();
      continue;
    }
    if (/\s/u.test(character)) return oneTime('complex_or_dynamic');
    if (character === "'") {
      tokenStarted = true;
      mode = 'single';
      continue;
    }
    if (character === '"') {
      tokenStarted = true;
      mode = 'double';
      continue;
    }
    if (character === '`') {
      const next = command[index + 1];
      if (next === undefined) return oneTime('malformed_command');
      if (
        next === '\n'
        || next === '\r'
        || !POWERSHELL_STATIC_ESCAPES.has(next)
      ) {
        return oneTime('complex_or_dynamic');
      }
      tokenStarted = true;
      token += next;
      index += 1;
      continue;
    }
    if (
      POWERSHELL_DYNAMIC_OR_CONTROL_CHARACTERS.has(character)
      || POWERSHELL_UNQUOTED_EXPANSION_CHARACTERS.has(character)
    ) {
      return oneTime('complex_or_dynamic');
    }

    tokenStarted = true;
    token += character;
  }

  if (mode !== 'unquoted') return oneTime('malformed_command');
  finishToken();

  if (tokens.length === 0 || tokens[0].length === 0) {
    return oneTime('malformed_command');
  }
  if (tokens.includes('--%')) return oneTime('complex_or_dynamic');
  return { status: 'static', tokens };
}
