import type { WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCanvasInputEvents } from './performanceInputEvents';

interface FocusSource {
  isFocused(): boolean;
  on(event: 'focus' | 'blur', listener: () => void): unknown;
  removeListener(event: 'focus' | 'blur', listener: () => void): unknown;
}
type InputWindow = FocusSource & {
  readonly webContents: FocusSource & Pick<WebContents, 'executeJavaScript' | 'sendInputEvent'>;
};
/** 只观察实际send与焦点事实，不调用focus/show，也不重试输入。 */
export async function startCanvasPerformanceInputTrace(window: InputWindow, output: string, profiling: boolean) {
  const stream = createCanvasInputEvents(), startedAt = performance.now();
  const focusState = () => ({ window: window.isFocused(), webContents: window.webContents.isFocused() });
  const record = (kind: string) => stream.record({ kind, atMs: performance.now(), focus: focusState() });
  const windowFocus = () => record('window-focus'), windowBlur = () => record('window-blur');
  const contentsFocus = () => record('webContents-focus'), contentsBlur = () => record('webContents-blur');
  const remove = () => {
    window.removeListener('focus', windowFocus); window.removeListener('blur', windowBlur);
    window.webContents.removeListener('focus', contentsFocus); window.webContents.removeListener('blur', contentsBlur);
  };
  const save = (renderer: unknown, rendererFailure: string | null) => writeFile(path.join(output, 'input-trace.json'), JSON.stringify({
    diagnostic: 'input-trace', validHardwareRun: false, profiling,
    clock: 'node-performance', timeOrigin: performance.timeOrigin, startedAt, endedAt: performance.now(), finalFocus: focusState(),
    ...stream.read(), renderer, rendererFailure }, null, 2));
  window.on('focus', windowFocus); window.on('blur', windowBlur);
  window.webContents.on('focus', contentsFocus); window.webContents.on('blur', contentsBlur);
  record('start');
  try { await window.webContents.executeJavaScript('window.beginCanvasPerformanceInputTrace()'); }
  catch (error) { remove(); await save(undefined, error instanceof Error ? error.message : String(error)); throw error; }
  return {
    send(input: Parameters<WebContents['sendInputEvent']>[0]) {
      const beforeMs = performance.now(), beforeFocus = focusState();
      try { window.webContents.sendInputEvent(input); }
      finally { stream.record({ kind: 'native-sent', input, beforeMs, afterMs: performance.now(), beforeFocus, afterFocus: focusState() }); }
    },
    async finish() {
      let renderer: unknown;
      let rendererFailure: string | null = null;
      try { renderer = await window.webContents.executeJavaScript('window.finishCanvasPerformanceInputTrace()'); }
      catch (error) { rendererFailure = error instanceof Error ? error.message : String(error); throw error; }
      finally {
        record('finish'); remove();
        await save(renderer, rendererFailure);
      }
    },
  };
}
