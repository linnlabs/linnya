import { Application, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Texture } from 'pixi.js';
import { createPixiCanvasKernel } from '../../src/renderer/kernel';
import { createCanvasPlainTextDocument, readCanvasCardCssPalette, type CanvasCamera } from '../../src/shared';
import { createVisibleUpdateFixture } from './visibleUpdateFixture';
import type { MapLabelPlacementEvidence } from './mapLabelPlacementDefinitions';
import { readCanvasVisualSampling } from './visualSampling';

async function placement(kind: string, titles: readonly string[], positions: readonly { x: number; y: number }[], camera: CanvasCamera, width: number, height: number) {
  const host = document.createElement('div'); host.style.cssText = `width:${width}px;height:${height}px`; document.body.append(host);
  const kernel = await createPixiCanvasKernel({ host, width, height, resolution: 2, renderingMode: 'capture' });
  const referenceApp = new Application(); let paperTexture: Texture | undefined, referenceTexture: Texture | undefined, referenceInitialized = false;
  try {
    const base = createVisibleUpdateFixture('text');
    // 跨格小夹具缩窄纸面，避免整卡互遮改变背景；标题锚点和同面积优先序保持固定。
    const cards = titles.map((title, index) => ({ ...base[index], ...positions[index], width: kind === 'map-placement-cross' ? 32 : 240, height: 120,
      data: { ...base[index].data, content: createCanvasPlainTextDocument(title) } }));
    const before = kernel.readStats().renders; kernel.setElements(cards); kernel.setCamera(camera);
    const start = performance.now();
    while (kernel.readStats().renders <= before || kernel.readStats().sceneTransitions || kernel.readStats().cameraTransition) {
      if (performance.now() - start > 5000) throw new Error('map_placement_actual_draw_timeout');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const rawKernelImage = await kernel.captureImage('png'), resolution = kernel.readResolution();
    await referenceApp.init({ width, height, resolution, antialias: true, autoStart: false, preference: 'webgl', backgroundAlpha: 0 });
    referenceInitialized = true;
    const decoded = new Image(); decoded.src = rawKernelImage; await decoded.decode();
    if (decoded.naturalWidth !== Math.round(width * resolution) || decoded.naturalHeight !== Math.round(height * resolution)) throw new Error('map_placement_kernel_sampling_mismatch');
    // 原输出已是不透明浅灰底。独立参考重现固定纸面采样，不能叠白掩盖越出纸面的字形AA差异。
    referenceApp.stage.addChild(new Graphics().rect(0, 0, width, height).fill(0xf2f3ee));
    const paper = document.createElement('canvas'); paper.width = paper.height = 32;
    const paperContext = paper.getContext('2d'); if (!paperContext) throw new Error('map_placement_paper_context_missing');
    paperContext.fillStyle = '#fff'; paperContext.shadowBlur = 3; paperContext.shadowOffsetY = 1; paperContext.shadowColor = '#0004';
    paperContext.beginPath(); paperContext.roundRect(3, 3, 26, 26, 2); paperContext.fill();
    paperTexture = Texture.from(paper);
    const world = new Container({ isRenderGroup: true }); world.position.set(camera.x, camera.y); world.scale.set(camera.zoom); referenceApp.stage.addChild(world);
    for (const card of cards) {
      const sheet = new NineSliceSprite({ texture: paperTexture, leftWidth: 8, rightWidth: 8, topHeight: 8, bottomHeight: 8 });
      const view = new Container(); view.position.set(card.x, card.y); view.addChild(sheet); world.addChild(view);
      sheet.width = card.width; sheet.height = card.height;
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('map_placement_reference_context_missing');
    context.font = '13px system-ui'; context.textBaseline = 'top'; context.fillStyle = readCanvasCardCssPalette('white', false).title;
    const candidates = cards.map((card, index) => ({ id: card.id, title: titles[index], column: index % 4,
      bounds: { x: card.x * camera.zoom + camera.x + 2, y: card.y * camera.zoom + camera.y + 2,
        width: context.measureText(titles[index]).width, height: 13 * 1.2 } }));
    if (candidates.some(row => row.title.length > 18 || row.bounds.width > 140)) throw new Error('map_placement_reference_requires_known_unfitted_titles');
    const accepted: typeof candidates = [];
    // 独立小夹具oracle只做逐对矩形判断，不读取production collision、fitting或Kernel私有字段。
    for (const row of candidates) if (!accepted.some(other => row.bounds.x < other.bounds.x + other.bounds.width
      && row.bounds.x + row.bounds.width > other.bounds.x && row.bounds.y < other.bounds.y + other.bounds.height
      && row.bounds.y + row.bounds.height > other.bounds.y)) accepted.push(row);
    if (kind === 'map-placement-cross' && (accepted.length !== 2 || accepted[0].id !== cards[0].id || accepted[1].id !== cards[2].id)) throw new Error('map_placement_cross_reference_degenerated');
    referenceTexture = Texture.from(canvas); const referenceSprite = new Sprite(referenceTexture); referenceApp.stage.addChild(referenceSprite);
    const renderReference = async (missingColumn?: number) => {
      context.clearRect(0, 0, width, height);
      for (const row of accepted) if (row.column !== missingColumn) context.fillText(row.title, row.bounds.x, row.bounds.y);
      referenceSprite.texture.source.update(); referenceApp.render();
      return referenceApp.renderer.extract.base64({ target: referenceApp.stage, frame: new Rectangle(0, 0, width, height), resolution });
    };
    // 固定删首列；首个优先标题必有期望墨迹，真实重叠造成其它列合理隐藏不能被当成损坏。
    const reference = await renderReference(), missingColumn = 0;
    if (!accepted.some(row => row.column === missingColumn)) throw new Error('map_placement_missing_column_negative_has_no_expected_ink');
    const missingColumnImage = await renderReference(missingColumn);
    const labelPlacement: MapLabelPlacementEvidence = { qualification: 'full-kernel-system-font-map-placement', camera,
      sampling: { ...readCanvasVisualSampling(kernel, 'capture'), mapCanvasDensity: 1, referenceCanvasDensity: 1 },
      candidates, expectedIds: accepted.map(row => row.id),
      stats: kernel.readStats(), missingColumn, missingColumnImage, rawKernelImage };
    return { kind, expected: accepted.map(row => row.title).join('\n'), image: rawKernelImage, reference, mode: 'ink',
      region: { x: 0, y: 0, width: decoded.naturalWidth, height: decoded.naturalHeight }, labelPlacement };
  } finally {
    referenceTexture?.destroy(true); paperTexture?.destroy(true);
    if (referenceInitialized) referenceApp.destroy(true, { children: true, texture: false });
    kernel.destroy(); host.remove();
  }
}

/** 固定原四列case与跨格case；合理可见数由真实字体的独立oracle产生，不预写60全显。 */
export async function collectCanvasMapPlacementPixels() {
  const sixty = Array.from({ length: 60 }, (_, index) => `[主题${'ABCD'[index % 4]}] 条目${index + 1}`);
  const camera = { x: 40, y: 131.18644067796612, zoom: 0.2796610169491525 };
  const crossCamera = { x: 0, y: 0, zoom: 0.25 };
  const measure = document.createElement('canvas').getContext('2d'); if (!measure) throw new Error('map_placement_measure_context_missing');
  measure.font = '13px system-ui'; const firstWidth = measure.measureText('优先').width;
  // .25是2的幂，已测文字右边缘可经世界坐标精确往返，贴边断言不引入额外epsilon。
  return [await placement('map-placement-60', sixty, sixty.map((_, index) => ({ x: index % 4 * 320, y: Math.floor(index / 4) * 160 })), camera, 1400, 900),
    await placement('map-placement-cross', ['优先', '跨格碰撞', '贴边'],
      // 屏幕x140加原160padding恰为索引格边300；139/141分别来自相邻格。
      [{ x: (141 - 2) * 4, y: 40 }, { x: (139 - 2) * 4, y: 40 }, { x: (141 + firstWidth - 2) * 4, y: 40 }], crossCamera, 400, 160)];
}
