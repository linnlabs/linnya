import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import './renderer.css';
import { probeKernel } from './kernelProbe';

interface HtmlCanvasContext extends CanvasRenderingContext2D {
  drawElementImage(element: Element, x: number, y: number): void;
}
interface PaintCanvas extends HTMLCanvasElement {
  requestPaint(): void;
}
function canDraw(context: CanvasRenderingContext2D): context is HtmlCanvasContext {
  return typeof Reflect.get(context, 'drawElementImage') === 'function';
}
function canRequest(canvas: HTMLCanvasElement): canvas is PaintCanvas {
  return typeof Reflect.get(canvas, 'requestPaint') === 'function';
}

const samples: readonly { readonly id: string; readonly content: JSONContent }[] = [
  { id: 'mixed', content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '真实中文 Markdown / Canvas' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '中文混排 English，标点（测试）与 Emoji 🖼️。' }, { type: 'text', text: '粗体不能丢失', marks: [{ type: 'bold' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表与内容高度采用同一排版引擎。' }] }] }] },
  ] } },
  { id: 'long', content: { type: 'doc', content: Array.from({ length: 150 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `${i}：长卡片正文。中文与 Western characters 应正确换行，不为全文分配一张超长纹理。`.repeat(4) }] })) } },
];

function createEditor(content: JSONContent, parent: HTMLElement): Editor {
  const element = document.createElement('div');
  element.className = 'card';
  parent.append(element);
  return new Editor({ element, extensions: [StarterKit], content, editable: false });
}

async function draw(canvas: HTMLCanvasElement, element: HTMLElement): Promise<{ readonly ink: number; readonly paintMs: number }> {
  const context = canvas.getContext('2d');
  if (!context || !canDraw(context)) throw new Error('HTML-in-Canvas unavailable');
  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { canvas.removeEventListener('paint', onPaint); reject(new Error('paint_timeout')); }, 1500);
    const onPaint = () => {
      clearTimeout(timeout);
      canvas.removeEventListener('paint', onPaint);
      try {
        context.drawElementImage(element, 0, 0);
        resolve();
      } catch (error) { reject(error); }
    };
    canvas.addEventListener('paint', onPaint);
    if (canRequest(canvas)) canvas.requestPaint();
  });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && pixels[i] < 150) ink++;
  }
  if (ink === 0) throw new Error('empty_rendered_bitmap');
  const bitmap = await createImageBitmap(canvas);
  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl2');
  if (!gl) throw new Error('webgl2_unavailable');
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  if (gl.getError() !== gl.NO_ERROR) throw new Error('bitmap_texture_upload_failed');
  gl.deleteTexture(texture);
  bitmap.close();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { ink, paintMs: performance.now() - started };
}

async function runCanvasProbe() {
  await document.fonts.ready;
  const results: { id: string; visibleHeight: number; hiddenHeight: number; paint?: unknown; error?: string }[] = [];
  for (const sample of samples) {
    const reference = document.createElement('div');
    document.body.append(reference);
    const referenceEditor = createEditor(sample.content, reference);
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 360;
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:280px;height:360px;z-index:-1';
    if ('content' in canvas) canvas.setAttribute('content', 'drawable');
    else canvas.setAttribute('layoutsubtree', '');
    const host = document.createElement('div');
    host.setAttribute('drawable', '');
    canvas.append(host);
    const editor = createEditor(sample.content, host);
    document.body.prepend(canvas);
    const visibleHeight = referenceEditor.view.dom.getBoundingClientRect().height;
    const hiddenHeight = editor.view.dom.getBoundingClientRect().height;
    const result: typeof results[number] = { id: sample.id, visibleHeight, hiddenHeight };
    try { result.paint = await draw(canvas, host); } catch (error) { result.error = String(error); }
    results.push(result);
    editor.destroy();
    referenceEditor.destroy();
    canvas.remove();
    reference.remove();
  }
  const source = document.createElement('div');
  document.body.append(source);
  const kernelEditor = createEditor(samples[0].content, source);
  let kernel: unknown;
  try { kernel = await probeKernel(source); } catch (error) { kernel = { error: String(error) }; }
  kernelEditor.destroy(); source.remove();
  return {
    kernel,
    kernelPassed: typeof kernel === 'object' && kernel !== null && !Reflect.has(kernel, 'error'),
    userAgent: navigator.userAgent,
    visibility: document.visibilityState,
    dpr: devicePixelRatio,
    measurementPassed: results.every((r) => r.visibleHeight > 0 && r.visibleHeight === r.hiddenHeight),
    drawingPassed: results.every((r) => r.paint !== undefined && r.error === undefined),
    samples: results,
  };
}
Object.defineProperty(window, 'runCanvasProbe', { value: runCanvasProbe });
