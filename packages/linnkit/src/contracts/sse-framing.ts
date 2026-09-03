import { createParser } from 'eventsource-parser';

/**
 * 传输层解析后的单个 SSE frame。
 *
 * 这里只表达 EventSource framing，不解释 `data` 中的 JSON 或业务事件类型。业务 payload
 * 必须继续由各接入方自己的 schema 在不可信边界校验。
 */
export interface ServerSentEventFrame {
  readonly event?: string;
  readonly data: string;
  readonly id?: string;
}

/** 一个 parser 实例只消费一条字节流，`finish` 后不得复用。 */
export interface ServerSentEventFrameParser {
  feed(chunk: Uint8Array): readonly ServerSentEventFrame[];
  finish(): readonly ServerSentEventFrame[];
}

/** 把结构化 frame 序列化为可直接写入 SSE 字节流的 UTF-8 文本。 */
export function serializeServerSentEventFrame(frame: ServerSentEventFrame): string {
  const lines: string[] = [];
  if (frame.event !== undefined) lines.push(`event: ${frame.event}`);
  if (frame.id !== undefined) lines.push(`id: ${frame.id}`);
  for (const dataLine of frame.data.split('\n')) {
    lines.push(`data: ${dataLine}`);
  }
  return `${lines.join('\n')}\n\n`;
}

/**
 * 创建 browser-safe 的 SSE framing parser。
 *
 * UTF-8 解码与 EventSource 分帧必须由同一个实例连续完成，才能正确处理任意网络 chunk
 * 边界、CR/LF/CRLF 以及多行 `data:`。本函数故意不解析 JSON，也不决定 EOF 的业务含义。
 */
export function createServerSentEventFrameParser(): ServerSentEventFrameParser {
  const decoder = new TextDecoder();
  const pendingFrames: ServerSentEventFrame[] = [];
  let finished = false;

  const parser = createParser({
    onEvent: ({ event, data, id }) => {
      pendingFrames.push({
        ...(event === undefined ? {} : { event }),
        data,
        ...(id === undefined ? {} : { id }),
      });
    },
  });

  const takeFrames = (): readonly ServerSentEventFrame[] => pendingFrames.splice(0);

  return {
    feed(chunk) {
      if (finished) {
        throw new Error('Cannot feed a finished SSE frame parser');
      }
      parser.feed(decoder.decode(chunk, { stream: true }));
      return takeFrames();
    },
    finish() {
      if (finished) {
        throw new Error('Cannot finish an SSE frame parser twice');
      }
      finished = true;
      const trailingText = decoder.decode();
      if (trailingText) {
        parser.feed(trailingText);
      }
      // consume 仅结束最后一行；没有空行封口的 frame 按 SSE 协议不分发。
      parser.reset({ consume: true });
      return takeFrames();
    },
  };
}
