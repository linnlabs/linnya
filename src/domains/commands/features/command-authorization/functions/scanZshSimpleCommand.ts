import type { StaticCommandScanResult } from '../definitions/simpleCommand';

type QuoteMode = 'unquoted' | 'single' | 'double';

const ZSH_DYNAMIC_OR_CONTROL_CHARACTERS = new Set([
  '|', '&', ';', '<', '>', '(', ')', '$', '`', '\n', '\r',
]);
const ZSH_UNQUOTED_EXPANSION_CHARACTERS = new Set([
  '*', '?', '[', ']', '{', '}', '~', '!', '^', '#',
]);

function oneTime(
  reason: 'complex_or_dynamic' | 'malformed_command',
): StaticCommandScanResult {
  return { status: 'one_time_only', reason };
}

/**
 * 这里只承认 zsh 中能够静态确定的单命令小子集，不尝试实现完整 Shell 语法。
 * 遇到展开、控制操作符或歧义时，命令仍可走单次审批，只是不生成长期记忆。
 */
export function scanZshSimpleCommand(command: string): StaticCommandScanResult {
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

    if (mode === 'single') {
      if (character === "'") {
        mode = 'unquoted';
      } else {
        token += character;
      }
      continue;
    }

    if (mode === 'double') {
      if (character === '"') {
        mode = 'unquoted';
        continue;
      }
      if (character === '$' || character === '`') {
        return oneTime('complex_or_dynamic');
      }
      if (character === '\\') {
        const next = command[index + 1];
        if (next === undefined) return oneTime('malformed_command');
        if (next === '$' || next === '`' || next === '"' || next === '\\') {
          token += next;
          index += 1;
        } else {
          token += `\\${next}`;
          index += 1;
        }
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
    if (character === '\\') {
      const next = command[index + 1];
      if (next === undefined || next === '\n' || next === '\r') {
        return oneTime('malformed_command');
      }
      tokenStarted = true;
      token += next;
      index += 1;
      continue;
    }
    if (
      ZSH_DYNAMIC_OR_CONTROL_CHARACTERS.has(character)
      || ZSH_UNQUOTED_EXPANSION_CHARACTERS.has(character)
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
  if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/u.test(tokens[0])) {
    return oneTime('complex_or_dynamic');
  }
  if (tokens.some(current => current.startsWith('='))) {
    return oneTime('complex_or_dynamic');
  }
  return { status: 'static', tokens };
}
