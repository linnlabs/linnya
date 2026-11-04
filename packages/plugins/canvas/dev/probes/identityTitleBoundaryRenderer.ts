import { Application, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { createPixiCanvasKernel } from '../../src/renderer/kernel';
import { CanvasMapLabels } from '../../src/renderer/kernel/render/pixi/CanvasMapLabels';
import { createCanvasPlainTextDocument, readCanvasCardCssPalette, readCanvasCardPalette } from '../../src/shared';
import { createVisibleUpdateFixture } from './visibleUpdateFixture';

async function mapPrefix() {
  const app = new Application();
  await app.init({ width: 300, height: 150, autoStart: false, preference: 'webgl', backgroundAlpha: 0 });
  const map = new CanvasMapLabels(), expected = 'i'.repeat(17) + '😀'; let reference: Texture | undefined;
  try {
    app.stage.addChild(map.sprite);
    map.draw({ cards: createVisibleUpdateFixture('text').slice(0, 1), camera: { x: 20, y: 20, zoom: 0.1 },
      width: 300, height: 150, dark: false, visible: true, readTitle: () => expected + '后文' });
    app.render(); const image = await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 300, 150) });
    // 参考只交给同一浏览器原生Canvas完整字符串，不再调用被测prefix或复制字体排版。
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 150;
    const context = canvas.getContext('2d'); if (!context) throw new Error('title_reference_context_missing');
    context.font = '12px system-ui'; context.textBaseline = 'top'; context.fillStyle = readCanvasCardCssPalette('white', false).title;
    context.fillText(expected, 22, 22); reference = Texture.from(canvas);
    map.sprite.visible = false; app.stage.addChild(new Sprite(reference)); app.render();
    return { kind: 'map-18', expected, image, reference: await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 300, 150) }),
      mode: 'alpha', region: { x: 0, y: 0, width: 300, height: 150 } };
  } finally { map.destroy(); reference?.destroy(true); app.destroy(true, { children: true, texture: false }); }
}

async function nearTitle(kind: string, source: string, expected: string, width: number) {
  const app = new Application();
  await app.init({ width: 1300, height: 120, resolution: 2, autoStart: false, preference: 'webgl', backgroundColor: 0xffffff });
  const host = document.createElement('div'); host.style.cssText = 'width:1300px;height:120px'; document.body.append(host);
  try {
    const kernel = await createPixiCanvasKernel({ host, width: 1300, height: 120, resolution: 2 });
    try {
      const card = createVisibleUpdateFixture('text')[0], x = Math.min(14, width / 8);
      kernel.setElements([{ ...card, x: 0, y: 0, width, height: 96, data: { ...card.data, content: createCanvasPlainTextDocument(source) } }]);
      // schedule已登记主画布RAF；明确等它完成，不能把PNG异步编码当作真实draw等待。
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const image = await kernel.captureImage('png'), stats = kernel.readStats();
      const text = new Text({ text: expected, resolution: 2, style: { fill: 0xffffff, fontFamily: 'system-ui', fontSize: 15, wordWrap: false } });
      text.tint = readCanvasCardPalette('white', false).title; text.position.set(x, 12); app.stage.addChild(text); app.render();
      return { kind, expected, image, reference: await app.renderer.extract.base64({ target: app.stage, frame: new Rectangle(0, 0, 1300, 120), resolution: 2 }),
        mode: 'ink', region: { x: 0, y: 20, width: Math.ceil(width * 2), height: 80 }, stats };
    } finally { kernel.destroy(); }
  } finally { host.remove(); app.destroy(true, { children: true, texture: false }); }
}

/** 真实Kernel与独立原生整串参考；覆盖计数边界和宽度省略，而非重写Unicode/font engine。 */
export async function collectCanvasTitleBoundaryPixels() {
  const prefix = 'i'.repeat(119) + '👨‍👩‍👧‍👦', fitted = 'e\u0301👨‍👩‍👧‍👦…';
  const context = document.createElement('canvas').getContext('2d'); if (!context) throw new Error('title_measure_context_missing');
  context.font = '15px system-ui';
  // 小卡内宽为总宽的3/4，恰好容纳已知完整前缀+省略号，下一W明显超宽。
  const width = (context.measureText(fitted).width + 0.25) / 0.75;
  return [await mapPrefix(), await nearTitle('near-120', prefix + '后文', prefix, 1200),
    await nearTitle('near-width', 'e\u0301👨‍👩‍👧‍👦WWWWWW', fitted, width)];
}
