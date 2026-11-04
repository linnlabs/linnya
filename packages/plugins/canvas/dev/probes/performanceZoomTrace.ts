import { startCanvasPhaseTrace } from './canvasPhaseTrace';

/** 仅诊断单次真实zoom；正常Native门禁不安装逐帧观察器。 */
export async function startCanvasZoomTrace(window: {
  readonly webContents: { executeJavaScript(code: string): Promise<unknown> };
}, output: string, stem: string, detailed = false) {
  return startCanvasPhaseTrace({ output, stem, phase: 'zoom',
    start: () => window.webContents.executeJavaScript(detailed ? 'window.startCanvasPerformanceZoomTrace(true)' : 'window.startCanvasPerformanceZoomTrace()'),
    finish: () => window.webContents.executeJavaScript('window.finishCanvasPerformanceZoomTrace()') });
}
