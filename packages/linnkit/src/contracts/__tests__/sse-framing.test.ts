import { describe, expect, it } from 'vitest';

import {
  createServerSentEventFrameParser,
  serializeServerSentEventFrame,
} from '../sse-framing';

function splitEveryByte(value: string): Uint8Array[] {
  return Array.from(new TextEncoder().encode(value), (byte) => Uint8Array.of(byte));
}

describe('SSE framing contract', () => {
  it('在 UTF-8 字符和三种换行被任意切片时仍按协议还原有序 frames', () => {
    const source = [
      'event: thought\r\n',
      'id: event-1\r\n',
      'data: {"content":\r\n',
      'data: "你好"}\r\n',
      '\r\n',
      ': heartbeat\n',
      'event: transport_end\n',
      'data:{"reason":"complete"}\n',
      '\n',
      'event: ignored\r',
      'data: incomplete',
    ].join('');
    const parser = createServerSentEventFrameParser();
    const frames = splitEveryByte(source).flatMap((chunk) => parser.feed(chunk));
    frames.push(...parser.finish());

    expect(frames).toEqual([
      {
        event: 'thought',
        id: 'event-1',
        data: '{"content":\n"你好"}',
      },
      {
        event: 'transport_end',
        data: '{"reason":"complete"}',
      },
    ]);
  });

  it('结构化 frame 重新序列化后保持 event、id 和多行 data 语义', () => {
    const expected = {
      event: 'provider_delta',
      id: 'provider-event-1',
      data: '{"first":1,\n"second":2}',
    };
    const parser = createServerSentEventFrameParser();

    const frames = parser.feed(
      new TextEncoder().encode(serializeServerSentEventFrame(expected)),
    );
    parser.finish();

    expect(frames).toEqual([expected]);
  });
});
