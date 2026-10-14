import sharp from 'sharp';
import { admitSvgGraphic } from '../../src/backend/engine/svgGraphic';
import { createPresentationSvgGraphicFallbackRasterizer } from '../../src/backend/features/presentationSvgGraphicFallback';

export async function assertSvgGraphicFallbackRenders(): Promise<void> {
  const admitted = admitSvgGraphic('<svg viewBox="0 0 100 50"><circle cx="50" cy="25" r="18" fill="#2563EB"/></svg>');
  const raster = await createPresentationSvgGraphicFallbackRasterizer().rasterizeSvgGraphic(admitted);
  const decoded = await sharp(raster.pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (raster.widthPx !== 1920 || raster.heightPx !== 960
    || decoded.info.width !== raster.widthPx || decoded.info.height !== raster.heightPx) {
    throw new Error('SVG Graphic fallback returned invalid PNG dimensions');
  }
  const cornerAlpha = decoded.data[3];
  const centerIndex = (
    Math.floor(decoded.info.height / 2) * decoded.info.width
    + Math.floor(decoded.info.width / 2)
  ) * decoded.info.channels;
  const centerAlpha = decoded.data[centerIndex + 3];
  if (cornerAlpha !== 0 || centerAlpha !== 255) {
    throw new Error(`SVG Graphic fallback lost transparency: corner=${cornerAlpha}, center=${centerAlpha}`);
  }
  console.log(`SVG Graphic transparent fallback passed: ${raster.widthPx}x${raster.heightPx}`);
}
