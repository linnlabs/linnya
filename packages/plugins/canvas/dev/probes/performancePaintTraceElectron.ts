import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 每例finally取回已经发生的真实事件；失败也保留timeout现场，不改变原始门禁结果。 */
export async function startCanvasPaintTrace(contents: { executeJavaScript(expression: string): Promise<unknown> }, output: string, stem: string) {
  await contents.executeJavaScript('window.beginCanvasPerformancePaintTrace()');
  return async () => {
    const events: unknown = await contents.executeJavaScript('window.finishCanvasPerformancePaintTrace()');
    await writeFile(path.join(output, `${stem}-paint-events.json`), JSON.stringify(events, null, 2));
  };
}
