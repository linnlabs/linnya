import type { Rectangle } from 'electron';
import { z } from 'zod';

interface VisualDebuggerPort {
  attach(version: string): void;
  detach(): void;
  sendCommand(method: string, parameters: Record<string, unknown>): Promise<unknown>;
}
interface VisualCaptureInput {
  readonly rectangles: readonly [Rectangle, Rectangle, Rectangle];
  readonly zoomFactor: number;
  readonly dpr: number;
}

/** CDP clip 使用 DIP，DOM rect 使用 CSS px；窗口缩放必须计入，不能按受屏幕约束的视口裁图。 */
export async function captureCanvasVisualPage(debuggerPort: VisualDebuggerPort, input: VisualCaptureInput) {
  const width = Math.ceil(Math.max(...input.rectangles.map(rect => rect.x + rect.width)) * input.zoomFactor);
  const height = Math.ceil(Math.max(...input.rectangles.map(rect => rect.y + rect.height)) * input.zoomFactor);
  const clip = { x: 0, y: 0, width, height, scale: 1 };
  const deviceScale = input.dpr / input.zoomFactor;
  debuggerPort.attach('1.3');
  try {
    const response = z.object({ data: z.string().min(1) }).parse(await debuggerPort.sendCommand('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: true, clip,
    }));
    return { png: Buffer.from(response.data, 'base64'), clip,
      expectedSize: { width: Math.round(width * deviceScale), height: Math.round(height * deviceScale) } };
  } finally { debuggerPort.detach(); }
}
