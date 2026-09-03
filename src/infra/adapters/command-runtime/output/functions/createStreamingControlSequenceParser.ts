type ControlSequenceParserState =
  | 'ground'
  | 'escape'
  | 'escape-intermediate'
  | 'csi-parameter'
  | 'csi-intermediate'
  | 'csi-ignore'
  | 'string'
  | 'string-escape';

type TerminalStringKind = 'osc' | 'dcs' | 'sos' | 'pm' | 'apc';

export interface CommandControlSequenceParserFinalization {
  /** EOF 丢弃了未闭合的控制序列；原始 byte artifact 仍保留完整证据。 */
  readonly incompleteSequenceOmitted: boolean;
}

export interface StreamingControlSequenceParser {
  /** 输入必须已经完成字符集解码；返回值仍保留 tab、LF 与 CR。 */
  write(decodedText: string): string;
  /** EOF 收口幂等；未闭合控制序列不回放 payload。 */
  finalize(): CommandControlSequenceParserFinalization;
}

function isCancellation(code: number): boolean {
  return code === 0x18 || code === 0x1a;
}

function isC0OrDelete(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

function isC1(code: number): boolean {
  return code >= 0x80 && code <= 0x9f;
}

function isParameter(code: number): boolean {
  return code >= 0x30 && code <= 0x3f;
}

function isIntermediate(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

function isFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

function visibleControl(code: number): string {
  if (code === 0x09 || code === 0x0a || code === 0x0d) {
    return String.fromCharCode(code);
  }
  return `\\x${code.toString(16).padStart(2, '0')}`;
}

function containsTerminalControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * 普通 pipe 只需要安全纯文本，不需要模拟终端屏幕。这个 parser 因此只保存状态，
 * 从不保存 OSC/DCS payload；恶意的未终止字符串即使持续数 GiB，也不会扩大 parser 内存。
 * 显式 PTY 必须走成熟 terminal parser，不能复用本模块。
 */
export function createStreamingControlSequenceParser(): StreamingControlSequenceParser {
  let state: ControlSequenceParserState = 'ground';
  let terminalStringKind: TerminalStringKind | undefined;
  let finalization: CommandControlSequenceParserFinalization | undefined;

  function enterString(kind: TerminalStringKind): void {
    terminalStringKind = kind;
    state = 'string';
  }

  function enterC1Sequence(code: number): boolean {
    switch (code) {
      case 0x90:
        enterString('dcs');
        return true;
      case 0x98:
        enterString('sos');
        return true;
      case 0x9b:
        terminalStringKind = undefined;
        state = 'csi-parameter';
        return true;
      case 0x9d:
        enterString('osc');
        return true;
      case 0x9e:
        enterString('pm');
        return true;
      case 0x9f:
        enterString('apc');
        return true;
      default:
        return false;
    }
  }

  function cancelSequence(): void {
    terminalStringKind = undefined;
    state = 'ground';
  }

  function restartEscape(): void {
    terminalStringKind = undefined;
    state = 'escape';
  }

  const parser: StreamingControlSequenceParser = {
    write(decodedText) {
      if (finalization) {
        throw new Error('cannot parse command output after control sequence finalization');
      }
      if (decodedText.length === 0) return '';
      if (state === 'ground' && !containsTerminalControl(decodedText)) return decodedText;

      const output: string[] = [];
      let index = 0;
      while (index < decodedText.length) {
        const code = decodedText.charCodeAt(index);

        if (state === 'ground') {
          if (code === 0x1b) {
            state = 'escape';
          } else if (!enterC1Sequence(code)) {
            output.push(isC0OrDelete(code) || isC1(code)
              ? visibleControl(code)
              : decodedText.charAt(index));
          }
          index += 1;
          continue;
        }

        if (state === 'string' || state === 'string-escape') {
          if (isCancellation(code)) {
            cancelSequence();
          } else if (code === 0x9c) {
            cancelSequence();
          } else if (terminalStringKind === 'osc' && code === 0x07) {
            cancelSequence();
          } else if (state === 'string-escape' && code === 0x5c) {
            cancelSequence();
          } else if (code === 0x1b) {
            state = 'string-escape';
          } else {
            state = 'string';
          }
          index += 1;
          continue;
        }

        if (isCancellation(code)) {
          cancelSequence();
          index += 1;
          continue;
        }
        if (code === 0x1b) {
          restartEscape();
          index += 1;
          continue;
        }
        if (enterC1Sequence(code)) {
          index += 1;
          continue;
        }

        if (state === 'escape') {
          switch (code) {
            case 0x5b:
              state = 'csi-parameter';
              break;
            case 0x5d:
              enterString('osc');
              break;
            case 0x50:
              enterString('dcs');
              break;
            case 0x58:
              enterString('sos');
              break;
            case 0x5e:
              enterString('pm');
              break;
            case 0x5f:
              enterString('apc');
              break;
            default:
              if (isIntermediate(code)) {
                state = 'escape-intermediate';
              } else if (code >= 0x30 && code <= 0x7e) {
                cancelSequence();
              } else if (isC0OrDelete(code) || isC1(code)) {
                output.push(visibleControl(code));
              } else {
                cancelSequence();
                continue;
              }
          }
          index += 1;
          continue;
        }

        if (state === 'escape-intermediate') {
          if (isIntermediate(code)) {
            index += 1;
          } else if (code >= 0x30 && code <= 0x7e) {
            cancelSequence();
            index += 1;
          } else if (isC0OrDelete(code) || isC1(code)) {
            output.push(visibleControl(code));
            index += 1;
          } else {
            cancelSequence();
          }
          continue;
        }

        if (isC0OrDelete(code) || isC1(code)) {
          output.push(visibleControl(code));
          index += 1;
          continue;
        }

        if (state === 'csi-parameter') {
          if (isParameter(code)) {
            index += 1;
          } else if (isIntermediate(code)) {
            state = 'csi-intermediate';
            index += 1;
          } else if (isFinal(code)) {
            cancelSequence();
            index += 1;
          } else {
            state = 'csi-ignore';
            index += 1;
          }
          continue;
        }

        if (state === 'csi-intermediate') {
          if (isIntermediate(code)) {
            index += 1;
          } else if (isFinal(code)) {
            cancelSequence();
            index += 1;
          } else {
            state = 'csi-ignore';
            index += 1;
          }
          continue;
        }

        if (isFinal(code)) cancelSequence();
        index += 1;
      }

      return output.join('');
    },
    finalize() {
      if (finalization) return finalization;
      finalization = Object.freeze({
        incompleteSequenceOmitted: state !== 'ground',
      });
      return finalization;
    },
  };

  return Object.freeze(parser);
}
