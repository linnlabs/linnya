import { Rectangle, Sprite, Texture } from 'pixi.js';
import type { CanvasRectangle } from '../../../../shared';
import type { CanvasRasterTile } from '../../definitions/canvasKernel';

export interface CanvasBitmapOwner { readonly texture: Texture; readonly bitmap: ImageBitmap; readonly frame: CanvasRectangle; references: number }
export interface CanvasBitmapRegion extends CanvasRectangle { readonly scale: number; readonly owner: CanvasBitmapOwner; readonly sprite: Sprite; readonly texture: Texture }
export interface CanvasBitmapLayer { readonly regions: readonly CanvasBitmapRegion[]; alpha: number }

/** 位图只有一个owner；淡入旧层和新层的裁片共享引用，预算不重复计数，也不漏计退休资源。 */
export class CanvasBitmapResources {
  private bytes = 0;
  create(tile: CanvasRasterTile): CanvasBitmapOwner {
    const texture = Texture.from(tile.bitmap, true);
    this.bytes += tile.bitmap.width * tile.bitmap.height * 4;
    return { texture, bitmap: tile.bitmap, frame: { x: tile.x, y: tile.y, width: tile.width, height: tile.height }, references: 0 };
  }
  region(owner: CanvasBitmapOwner, frame: CanvasRectangle, scale: number): CanvasBitmapRegion {
    const source = owner.frame, x = (frame.x - source.x) / source.width * owner.bitmap.width, y = (frame.y - source.y) / source.height * owner.bitmap.height;
    const texture = new Texture({ source: owner.texture.source, frame: new Rectangle(x, y, frame.width / source.width * owner.bitmap.width, frame.height / source.height * owner.bitmap.height) });
    const sprite = new Sprite(texture); sprite.position.set(frame.x, frame.y); sprite.width = frame.width; sprite.height = frame.height;
    owner.references++; return { ...frame, scale, owner, texture, sprite };
  }
  release(region: CanvasBitmapRegion): void {
    region.sprite.removeFromParent(); region.sprite.destroy(); region.texture.destroy(false);
    const owner = region.owner; owner.references--;
    if (!owner.references) {
      this.bytes -= owner.bitmap.width * owner.bitmap.height * 4;
      owner.texture.destroy(true); owner.bitmap.close();
    }
  }
  readBytes(): number { return this.bytes; }
}

export function setCanvasBitmapLayerAlpha(layer: CanvasBitmapLayer, alpha: number): void {
  layer.alpha = alpha;
  for (const region of layer.regions) region.sprite.alpha = alpha;
}
