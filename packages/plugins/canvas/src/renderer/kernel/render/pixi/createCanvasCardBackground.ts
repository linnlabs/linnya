import { Texture } from 'pixi.js';

export function createCanvasCardBackground(material: 'paper' | 'card'): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_2d_unavailable');
  context.fillStyle = '#fff';
  if (material === 'paper') {
    context.shadowBlur = 3;
    context.shadowOffsetY = 1;
    context.shadowColor = '#0004';
  }
  context.beginPath();
  context.roundRect(3, 3, 26, 26, material === 'paper' ? 2 : 6);
  context.fill();
  if (material === 'card') {
    context.strokeStyle = '#aaa';
    context.lineWidth = 0.5;
    context.stroke();
  }
  return Texture.from(canvas);
}

/** 在挂载主画布前创建纸面资源，保持构造失败时尚未安装 DOM/上下文监听。 */
export function createCanvasCardBackgrounds() {
  return { paper: createCanvasCardBackground('paper'), card: createCanvasCardBackground('card') };
}
