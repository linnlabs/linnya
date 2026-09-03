import type { WebEvidenceWriter } from '../ports/webEvidenceWriter';

const writerByToolContext = new WeakMap<object, WebEvidenceWriter>();

/** Host 在 Web producer 执行前绑定当前 conversation scope 的写入端口。 */
export function attachWebEvidenceWriter(
  toolContext: object,
  writer: WebEvidenceWriter,
): void {
  writerByToolContext.set(toolContext, writer);
}

/** Web producer 不得绕过 Host admission 自选 concrete writer。 */
export function requireWebEvidenceWriter(toolContext: object): WebEvidenceWriter {
  const writer = writerByToolContext.get(toolContext);
  if (!writer) {
    throw new Error('Web evidence capture requires a host-admitted writer.');
  }
  return writer;
}
