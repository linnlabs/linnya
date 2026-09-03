import * as brush from 'p5.brush/standalone';
import type {
  BrushArtworkFill,
  BrushArtworkLayer,
  BrushArtworkMark,
  BrushArtworkPoint,
  BrushArtworkPosition,
  BrushArtworkRenderRequest,
} from '@plugin/slides/shared/brushArtwork';

interface BrushArtworkCanvasScale {
  readonly x: number;
  readonly y: number;
  readonly short: number;
}

export function renderBrushArtworkIntent(request: BrushArtworkRenderRequest): void {
  const { intent } = request;
  brush.seed(intent.seed);
  brush.noiseSeed(intent.seed);
  brush.angleMode(brush.DEGREES);
  resetDrawingState();
  brush.clear(intent.backgroundColor);
  brush.push();
  brush.translate(-request.widthPx / 2, -request.heightPx / 2);

  const scale = {
    x: request.widthPx / 100,
    y: request.heightPx / 100,
    short: Math.min(request.widthPx, request.heightPx) / 100,
  };
  for (const [layerIndex, layer] of intent.layers.entries()) {
    renderLayer(layer, scale, intent.seed, layerIndex);
  }

  brush.pop();
  brush.render();
}

function renderLayer(
  layer: BrushArtworkLayer,
  scale: BrushArtworkCanvasScale,
  seed: number,
  layerIndex: number,
): void {
  resetDrawingState();
  if (layer.field) brush.field(layer.field);
  if (layer.stroke) {
    brush.set(layer.stroke.brush, layer.stroke.color, toShortPixels(layer.stroke.weight ?? 1, scale));
  }
  if (layer.fill) applyFill(layer.fill);
  if (layer.hatch) {
    brush.hatchStyle(
      layer.hatch.brush,
      layer.hatch.color,
      toShortPixels(layer.hatch.weight ?? 0.65, scale),
    );
    brush.hatch(toShortPixels(layer.hatch.spacing ?? 2.5, scale), layer.hatch.angle ?? 45, {
      rand: layer.hatch.randomness ?? 0,
      continuous: layer.hatch.continuous ?? false,
      gradient: layer.hatch.gradient ?? 0,
    });
  }
  for (const [markIndex, mark] of layer.marks.entries()) {
    renderMark(mark, scale, seed, layerIndex, markIndex);
  }
}

function resetDrawingState(): void {
  brush.noField();
  brush.noStroke();
  brush.noFill();
  brush.noWash();
  brush.noMass();
  brush.noHatch();
}

function applyFill(fill: BrushArtworkFill): void {
  switch (fill.kind) {
    case 'watercolor':
      brush.fill(fill.color, fill.opacity ?? 150);
      if (fill.bleedAngle == null) {
        brush.fillBleed(fill.bleed ?? 0.07, fill.bleedDirection ?? 'out');
      } else {
        brush.fillBleed(fill.bleed ?? 0.07, fill.bleedDirection ?? 'out', fill.bleedAngle);
      }
      brush.fillTexture(fill.texture ?? 0.8, fill.border ?? 0.5, fill.scatter ?? true);
      break;
    case 'wash':
      brush.wash(fill.color, fill.opacity ?? 150);
      break;
    case 'mass':
      brush.mass(fill.brush, fill.color, {
        precision: fill.precision ?? 0.5,
        strength: fill.strength ?? 1,
        gradient: fill.gradient ?? 0.1,
        outline: fill.outline ?? false,
      });
      break;
  }
}

function renderMark(
  mark: BrushArtworkMark,
  scale: BrushArtworkCanvasScale,
  seed: number,
  layerIndex: number,
  markIndex: number,
): void {
  switch (mark.type) {
    case 'line': {
      const from = toPixelPosition(mark.from, scale);
      const to = toPixelPosition(mark.to, scale);
      brush.line(from[0], from[1], to[0], to[1]);
      break;
    }
    case 'spline':
      brush.spline(mark.points.map(point => toPixelPoint(point, scale)), mark.curvature ?? 0.5);
      break;
    case 'arc': {
      const center = toPixelPosition(mark.center, scale);
      brush.arc(
        center[0],
        center[1],
        toShortPixels(mark.radius, scale),
        mark.startAngle,
        mark.endAngle,
      );
      break;
    }
    case 'rect':
      brush.rect(
        mark.x * scale.x,
        mark.y * scale.y,
        mark.width * scale.x,
        mark.height * scale.y,
        'corner',
      );
      break;
    case 'ellipse':
      renderEllipse(mark, scale, seed, layerIndex, markIndex);
      break;
    case 'polygon':
      renderClosedPoints(mark.points.map(point => toPixelPoint(point, scale)), 0);
      break;
    case 'flowLine': {
      const from = toPixelPosition(mark.from, scale);
      brush.flowLine(
        from[0],
        from[1],
        toShortPixels(mark.length, scale),
        mark.direction,
      );
      break;
    }
  }
}

function renderEllipse(
  mark: Extract<BrushArtworkMark, { readonly type: 'ellipse' }>,
  scale: BrushArtworkCanvasScale,
  seed: number,
  layerIndex: number,
  markIndex: number,
): void {
  const center = toPixelPosition(mark.center, scale);
  const radiusX = mark.radiusX * scale.x;
  const radiusY = mark.radiusY * scale.y;
  const irregularity = mark.irregularity ?? 0;
  const points: BrushArtworkPoint[] = [];
  const segmentCount = 24;
  for (let index = 0; index < segmentCount; index += 1) {
    const angle = (Math.PI * 2 * index) / segmentCount;
    const jitter = 1 + irregularity * 0.08 * signedNoise(seed, layerIndex, markIndex, index);
    points.push([
      center[0] + Math.cos(angle) * radiusX * jitter,
      center[1] + Math.sin(angle) * radiusY * jitter,
      1,
    ]);
  }
  renderClosedPoints(points, 0.65);
}

function renderClosedPoints(points: readonly BrushArtworkPoint[], curvature: number): void {
  brush.beginShape(curvature);
  for (const point of points) brush.vertex(point[0], point[1], point[2] ?? 1);
  brush.endShape(true);
}

function toPixelPosition(
  point: BrushArtworkPosition,
  scale: BrushArtworkCanvasScale,
): readonly [number, number] {
  return [point[0] * scale.x, point[1] * scale.y];
}

function toPixelPoint(
  point: BrushArtworkPoint,
  scale: BrushArtworkCanvasScale,
): [number, number, number] {
  return [point[0] * scale.x, point[1] * scale.y, point[2] ?? 1];
}

function toShortPixels(value: number, scale: BrushArtworkCanvasScale): number {
  return value * scale.short;
}

/** 只扰动显式 irregularity；相同 seed/layer/mark 永远产生相同轮廓。 */
function signedNoise(seed: number, layerIndex: number, markIndex: number, pointIndex: number): number {
  let value = seed ^ Math.imul(layerIndex + 1, 0x9E3779B1);
  value ^= Math.imul(markIndex + 1, 0x85EBCA77);
  value ^= Math.imul(pointIndex + 1, 0xC2B2AE3D);
  value = Math.imul(value ^ (value >>> 16), 0x7FEB352D);
  value = Math.imul(value ^ (value >>> 15), 0x846CA68B);
  return ((value ^ (value >>> 16)) >>> 0) / 0x7FFFFFFF - 1;
}
