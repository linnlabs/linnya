import type { VisualImage, VisualTextLayout } from './definitions';
import { compareVisualTextLayout } from './compareVisualTextLayout';
import { compareVisualTextPixels } from './compareVisualTextPixels';

export function evaluateVisualTextOracle(input: { reference: VisualImage; raster: VisualImage; pixi: VisualImage;
  layout: { reference: VisualTextLayout; rasters: readonly VisualTextLayout[] } }) {
  const layouts = input.layout.rasters.map(source => compareVisualTextLayout(input.layout.reference, source));
  const raster = compareVisualTextPixels(input.reference, input.raster, input.layout.reference);
  const pixi = compareVisualTextPixels(input.reference, input.pixi, input.layout.reference, { pixi: true });
  return { pass: layouts.length > 0 && layouts.every(layout => layout.pass) && raster.pass && pixi.pass, layouts, raster, pixi };
}
