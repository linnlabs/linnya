import { Buffer } from 'node:buffer';

import type {
  CommandOutputTextEncoding,
  CommandPipeOutputChannel,
} from '@app/schemas/commands';
import iconv, { type DecoderStream } from 'iconv-lite';

interface MutableCommandOutputDecoder {
  readonly decoder: DecoderStream;
  finalized: boolean;
}

export interface CommandOutputStreamDecoders {
  /** 同步消费当前流的 byte；返回的文字只属于该流，尚未清理控制序列。 */
  write(channel: CommandPipeOutputChannel, bytes: Uint8Array): string;
  /** 每条系统 pipe 在 EOF 时独立收口；重复收口不再产生文本。 */
  finalize(channel: CommandPipeOutputChannel): string;
}

function resolveIconvEncoding(encoding: CommandOutputTextEncoding): string {
  switch (encoding) {
    case 'utf-8':
      return 'utf8';
    case 'windows-936':
      return 'cp936';
    default: {
      const unsupportedEncoding: never = encoding;
      throw new Error(`unsupported command output encoding: ${String(unsupportedEncoding)}`);
    }
  }
}

function createDecoder(encoding: string): MutableCommandOutputDecoder {
  return {
    decoder: iconv.getDecoder(encoding),
    finalized: false,
  };
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * 普通 pipe 的两个 byte 流不能交错后共用 decoder。多字节字符可能停在 stdout 的
 * 半个字符上，而同一时刻 stderr 已经到达；共享状态会把合法的两条流解码成乱码。
 */
export function decodeCommandOutputStreams(
  encoding: CommandOutputTextEncoding,
): CommandOutputStreamDecoders {
  const resolvedEncoding = resolveIconvEncoding(encoding);
  const streams: Record<CommandPipeOutputChannel, MutableCommandOutputDecoder> = {
    stdout: createDecoder(resolvedEncoding),
    stderr: createDecoder(resolvedEncoding),
  };

  return Object.freeze({
    write(channel: CommandPipeOutputChannel, bytes: Uint8Array) {
      const stream = streams[channel];
      if (stream.finalized) {
        throw new Error(`cannot decode ${channel} after output stream finalization`);
      }
      if (bytes.byteLength === 0) return '';
      return stream.decoder.write(asBuffer(bytes));
    },
    finalize(channel: CommandPipeOutputChannel) {
      const stream = streams[channel];
      if (stream.finalized) return '';
      const finalText = stream.decoder.end() ?? '';
      stream.finalized = true;
      return finalText;
    },
  });
}
