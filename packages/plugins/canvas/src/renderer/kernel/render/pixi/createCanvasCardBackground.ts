import { CanvasSource, Texture } from 'pixi.js';
import { CANVAS_CARD_CORNER_RADIUS, CANVAS_CARD_PAPER_INSET } from '../../geometry/canvasCardFrame';

/**
 * 贴图按 4 倍密度绘制：放大到 400% 的 Retina 屏上，圆角与 0.5px 描边仍清晰。
 * 缩小视图时同一贴图被大幅缩采，不足一像素的描边会随采样落点时有时无（同一张卡有的边消失），
 * 因此生成多级缩略图：缩小时取预先平均过的层级，四条边一样淡但都在。
 */
const DENSITY = 4;
/** 纸面贴图边长与九宫格切片（世界坐标）；切片覆盖纸面内缩与圆角。 */
const BACKGROUND_SIDE = 32;
export const CANVAS_CARD_BACKGROUND_SLICE = 8;
/**
 * 卡片材质的投影单独一张九宫格贴图：不随卡片颜色染色，也不改变纸面切片。
 * BLEED 是投影超出卡片几何矩形的距离；SLICE 覆盖投影在角上的全部弧度，长边上投影截面处处相同。
 */
export const CANVAS_CARD_SHADOW_BLEED = 12;
export const CANVAS_CARD_SHADOW_SLICE = 52;
const SHADOW_SIDE = CANVAS_CARD_SHADOW_SLICE * 2 + 8;

function drawTexture(side: number, draw: (context: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side * DENSITY;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_2d_unavailable');
  context.scale(DENSITY, DENSITY);
  draw(context);
  return new Texture({
    source: new CanvasSource({ resource: canvas, resolution: DENSITY, autoGenerateMipmaps: true }),
  });
}

export function createCanvasCardBackground(material: 'paper' | 'card'): Texture {
  return drawTexture(BACKGROUND_SIDE, context => {
    context.fillStyle = '#fff';
    if (material === 'paper') {
      context.shadowBlur = 3 * DENSITY;
      context.shadowOffsetY = 1 * DENSITY;
      context.shadowColor = '#0004';
    }
    const inset = CANVAS_CARD_PAPER_INSET,
      side = BACKGROUND_SIDE - inset * 2;
    context.beginPath();
    context.roundRect(inset, inset, side, side, CANVAS_CARD_CORNER_RADIUS[material]);
    context.fill();
    if (material === 'card') {
      context.strokeStyle = '#c2c2c2';
      context.lineWidth = 0.5;
      context.stroke();
    }
  });
}

/**
 * 卡片材质的两层投影：贴边的一层很淡的近影，加一层向下沉、收窄的远影，让平面卡浮在画布上。
 * 远影用负扩展（先把形状收进卡内再模糊），只在卡片下方露出；形状本身画在贴图外，只留阴影。
 */
export function createCanvasCardShadow(): Texture {
  return drawTexture(SHADOW_SIDE, context => {
    const radius = CANVAS_CARD_CORNER_RADIUS.card,
      edge = CANVAS_CARD_SHADOW_BLEED + CANVAS_CARD_PAPER_INSET,
      away = SHADOW_SIDE * 2;
    const layer = (spread: number, offsetY: number, blur: number, alpha: number) => {
      const side = SHADOW_SIDE - (edge + spread) * 2;
      context.shadowOffsetX = away * DENSITY;
      context.shadowOffsetY = offsetY * DENSITY;
      context.shadowBlur = blur * DENSITY;
      context.shadowColor = `rgba(0, 0, 0, ${alpha})`;
      context.beginPath();
      context.roundRect(edge + spread - away, edge + spread, side, side, radius);
      context.fill();
    };
    layer(0, 1, 3, 0.06);
    layer(10, 7, 18, 0.22);
  });
}

/** 在挂载主画布前创建纸面资源，保持构造失败时尚未安装 DOM/上下文监听。 */
export function createCanvasCardBackgrounds() {
  return {
    paper: createCanvasCardBackground('paper'),
    card: createCanvasCardBackground('card'),
    shadow: createCanvasCardShadow(),
  };
}
