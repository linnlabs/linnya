import sharp from 'sharp';
import { invokeHiddenWorker } from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import { parseSlideRasterResult, type SlideRasterRequest } from '../../src/shared/slideRasterization';

export async function assertGradientFidelityRenders(request: SlideRasterRequest): Promise<void> {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', {
    ...request,
    requestId: 'gradient-fidelity-eight-angles-and-ellipse',
    slideSize: { width: 4, height: 3, unit: 'in' },
    profile: { ...request.profile, viewportWidthPx: 800, viewportHeightPx: 600 },
    slide: {
      ...request.slide,
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [
        ...angles.map((angle, index) => ({
          id: `angle-${angle}`, kind: 'shape', zIndex: index,
          geometry: { type: 'preset', name: 'rect' },
          box: { x: index % 4, y: Math.floor(index / 4), w: 1, h: 1, unit: 'in' },
          fill: { type: 'linear', angle, stops: [
            { position: 0, color: '#000000' }, { position: 1, color: '#FFFFFF' },
          ] },
        })),
        {
          id: 'ellipse-2-to-1', kind: 'shape', zIndex: 8,
          geometry: { type: 'preset', name: 'ellipse' },
          box: { x: 1, y: 2, w: 2, h: 1, unit: 'in' },
          fill: { type: 'radial', stops: [
            { position: 0, color: '#000000' }, { position: 1, color: '#FFFFFF' },
          ] },
        },
      ],
    },
  }));
  if (raster.status === 'failure') throw new Error(raster.error.message);
  const { data, info } = await sharp(raster.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const red = (x: number, y: number) => data[(y * info.width + x) * info.channels];
  for (const [index, angle] of angles.entries()) {
    const x = (index % 4) * 200;
    const y = Math.floor(index / 4) * 200;
    const dx = red(x + 160, y + 100) - red(x + 40, y + 100);
    const dy = red(x + 100, y + 160) - red(x + 100, y + 40);
    const radians = angle * Math.PI / 180;
    for (const [difference, direction] of [[dx, Math.cos(radians)], [dy, Math.sin(radians)]]) {
      if (Math.abs(direction) < 0.01 ? Math.abs(difference) > 3 : difference * Math.sign(direction) < 50) {
        throw new Error(`Gradient ${angle} direction mismatch: dx=${dx}, dy=${dy}`);
      }
    }
  }
  const horizontal = red(560, 500);
  const vertical = red(400, 580);
  if (red(400, 500) > 10 || Math.abs(horizontal - vertical) > 5 || horizontal < 195 || horizontal > 215) {
    throw new Error(`Elliptical gradient radius/center mismatch: horizontal=${horizontal}, vertical=${vertical}`);
  }
  console.log('Gradient fidelity passed: eight angles and 2:1 radial ellipse pixel samples');
}
