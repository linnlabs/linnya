import type {
  CommandRiskLexicalScan,
  CommandRiskLexicalSegment,
} from '../definitions/commandRiskRule';

type QuoteMode = 'unquoted' | 'single' | 'double';
type Separator = CommandRiskLexicalSegment['separatorBefore'];

interface SubstitutionFrame {
  readonly resumeMode: QuoteMode;
  readonly closingCharacter: ')' | '`';
}

/**
 * 风险规则只需要找到字面量命令段，不需要执行或完整解释 Shell。这里故意只处理
 * 引号、常见连接符和命令替换；无法静态理解的展开仍交给真实 Shell，不能把本扫描
 * 器的结果宣传成安全证明。
 */
export function scanCommandRiskLexemes(params: {
  readonly command: string;
  readonly platform: 'macos' | 'windows';
  readonly shellSemantics: 'zsh' | 'powershell' | 'cmd';
}): CommandRiskLexicalScan {
  const segments: CommandRiskLexicalSegment[] = [];
  const tokens: string[] = [];
  const substitutions: SubstitutionFrame[] = [];
  let token = '';
  let tokenStarted = false;
  let mode: QuoteMode = 'unquoted';
  let separatorBefore: Separator = 'start';

  const finishToken = (): void => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = '';
    tokenStarted = false;
  };
  const finishSegment = (nextSeparator: Separator): void => {
    finishToken();
    if (tokens.length > 0) {
      segments.push({
        tokens: [...tokens],
        separatorBefore,
        shellSemantics: params.shellSemantics,
      });
      tokens.length = 0;
    }
    separatorBefore = nextSeparator;
  };
  const beginSubstitution = (
    closingCharacter: SubstitutionFrame['closingCharacter'],
    consumedCharacters: number,
  ): number => {
    finishSegment('substitution');
    substitutions.push({ resumeMode: mode, closingCharacter });
    mode = 'unquoted';
    return consumedCharacters;
  };

  for (let index = 0; index < params.command.length; index += 1) {
    const character = params.command[index];
    const next = params.command[index + 1];

    if (mode === 'single') {
      if (character === "'") {
        if (params.platform === 'windows' && next === "'") {
          token += "'";
          index += 1;
        } else {
          mode = 'unquoted';
        }
      } else {
        token += character;
      }
      continue;
    }

    if (mode === 'double') {
      if (params.shellSemantics !== 'cmd' && character === '$' && next === '(') {
        index += beginSubstitution(')', 1);
        continue;
      }
      if (params.shellSemantics === 'zsh' && character === '`') {
        index += beginSubstitution('`', 0);
        continue;
      }
      if (character === '"') {
        mode = 'unquoted';
        continue;
      }

      const escapeCharacter = params.shellSemantics === 'zsh'
        ? '\\'
        : params.shellSemantics === 'powershell' ? '`' : '^';
      if (character === escapeCharacter && next !== undefined) {
        if (next === '\n' || next === '\r') {
          index += 1;
        } else {
          token += next;
          index += 1;
        }
        continue;
      }
      token += character;
      continue;
    }

    const currentSubstitution = substitutions[substitutions.length - 1];
    if (
      currentSubstitution
      && character === currentSubstitution.closingCharacter
    ) {
      finishSegment('chain');
      mode = currentSubstitution.resumeMode;
      substitutions.pop();
      continue;
    }
    if (params.shellSemantics !== 'cmd' && character === '$' && next === '(') {
      index += beginSubstitution(')', 1);
      continue;
    }
    if (params.shellSemantics === 'zsh' && character === '`') {
      index += beginSubstitution('`', 0);
      continue;
    }

    if (params.shellSemantics !== 'cmd' && character === "'") {
      tokenStarted = true;
      mode = 'single';
      continue;
    }
    if (character === '"') {
      tokenStarted = true;
      mode = 'double';
      continue;
    }

    const escapeCharacter = params.shellSemantics === 'zsh'
      ? '\\'
      : params.shellSemantics === 'powershell' ? '`' : '^';
    if (character === escapeCharacter && next !== undefined) {
      if (next === '\n' || next === '\r') {
        index += 1;
      } else {
        tokenStarted = true;
        token += next;
        index += 1;
      }
      continue;
    }

    if (params.shellSemantics !== 'cmd' && character === '#' && !tokenStarted) {
      while (
        index + 1 < params.command.length
        && params.command[index + 1] !== '\n'
        && params.command[index + 1] !== '\r'
      ) {
        index += 1;
      }
      continue;
    }
    if (/\s/u.test(character)) {
      if (character === '\n' || character === '\r') {
        finishSegment('chain');
      } else {
        finishToken();
      }
      continue;
    }
    if (character === ';') {
      finishSegment('chain');
      continue;
    }
    if (character === '|') {
      finishSegment('pipe');
      if (next === '|') index += 1;
      continue;
    }
    if (character === '&') {
      if (next === '&') {
        finishSegment('chain');
        index += 1;
      } else if (
        params.shellSemantics === 'powershell'
        && tokens.length === 0
        && !tokenStarted
      ) {
        separatorBefore = separatorBefore === 'start' ? 'start' : separatorBefore;
      } else {
        finishSegment('chain');
      }
      continue;
    }
    if (character === '(' || character === '{') {
      finishSegment('substitution');
      continue;
    }
    if (character === ')' || character === '}') {
      finishSegment('chain');
      continue;
    }
    if (character === '<' || character === '>') {
      finishToken();
      tokens.push(next === character ? `${character}${character}` : character);
      if (next === character) index += 1;
      continue;
    }

    tokenStarted = true;
    token += character;
  }

  finishSegment('chain');
  return { command: params.command, platform: params.platform, segments };
}
