import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Sprite, Texture } from 'pixi.js';
import { CanvasIdentityAtlas } from '../CanvasIdentityAtlas';

// 只替换浏览器整串排版入口；页、Texture/Source、Sprite绑定与销毁均运行真实资源owner。
vi.mock('../canvasIdentityTextRaster', () => ({
  withCanvasIdentityTextRaster<T>(_text: string, resolution: number, consume: (raster: { readonly canvas: HTMLCanvasElement; readonly width: number; readonly height: number }) => T): T {
    return consume({ canvas: document.createElement('canvas'), width: 16 * resolution, height: 16 * resolution });
  },
}));

let atlas: CanvasIdentityAtlas;
let sprites: Sprite[];
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) });
  atlas = new CanvasIdentityAtlas({ budget: 8 * 1024 * 1024, reserve() {} }); sprites = [];
});
afterEach(() => { atlas.destroy(); for (const sprite of sprites) sprite.destroy(); vi.unstubAllGlobals(); });
function active(text: string) { const sprite = atlas.create(text); sprites.push(sprite); atlas.setActive(sprite, true); return sprite; }

it('同页多entry与同串共享：改名/移除不提前销页，最后视图释放只销一次', () => {
  const first = active('共享'), second = active('共享'), different = active('另一串'); atlas.flush(1);
  expect(first.texture).toBe(second.texture); expect(atlas.readStats().identityEntries).toBe(2);
  const source = first.texture.source, destroyed = vi.fn(); source.on('destroy', destroyed);
  expect(different.texture.source).toBe(source);
  atlas.remove(first); expect(destroyed).not.toHaveBeenCalled();
  atlas.setText(second, '改名'); expect(second.texture).toBe(Texture.EMPTY); expect(destroyed).not.toHaveBeenCalled();
  atlas.flush(1); expect(second.texture.source).toBe(source);
  atlas.remove(different); expect(destroyed).not.toHaveBeenCalled();
  atlas.remove(second); expect(destroyed).toHaveBeenCalledOnce();
  expect(atlas.readBytes()).toBe(0); expect(atlas.readStats().identityEntries).toBe(0);
});

it('混合active/hidden改名保持真实引用，隐藏但仍有视图的页可预算淘汰并重新接纳', () => {
  const visible = active('可见'), hidden = active('隐藏'); atlas.flush(1);
  const oldSource = visible.texture.source, oldDestroyed = vi.fn(); oldSource.on('destroy', oldDestroyed);
  atlas.setActive(hidden, false); atlas.setText(hidden, '隐藏改名'); atlas.trimTo(0);
  expect(oldDestroyed).not.toHaveBeenCalled(); expect(atlas.readStats().identityActiveLabels).toBe(1);
  atlas.setText(visible, '可见改名'); expect(oldDestroyed).toHaveBeenCalledOnce();
  atlas.flush(1); atlas.setActive(hidden, true); atlas.flush(1);
  const source = visible.texture.source, destroyed = vi.fn(); source.on('destroy', destroyed);
  expect(hidden.texture.source).toBe(source);
  atlas.setActive(visible, false); atlas.trimTo(0); expect(destroyed).not.toHaveBeenCalled();
  atlas.setActive(hidden, false); atlas.trimTo(0);
  expect(destroyed).toHaveBeenCalledOnce(); expect(visible.texture).toBe(Texture.EMPTY); expect(hidden.texture).toBe(Texture.EMPTY);
  expect(atlas.readBytes()).toBe(0);
  atlas.setActive(hidden, true); atlas.flush(1);
  expect(hidden.texture.source).not.toBe(source); expect(atlas.readStats().identityActiveLabels).toBe(1);
  atlas.remove(hidden); expect(atlas.readBytes()).toBe(0);
});

it('同页500标题整代替换及DPR升级后全部释放，旧页不早销或重复销毁', () => {
  const labels = Array.from({ length: 500 }, (_, i) => active(`旧${i}`)); atlas.flush(1);
  const source = labels[0].texture.source, destroyed = vi.fn(); source.on('destroy', destroyed);
  expect(labels.every(label => label.texture.source === source)).toBe(true);
  labels.forEach((label, i) => {
    atlas.setText(label, `新${i}`);
    expect(destroyed).toHaveBeenCalledTimes(i === labels.length - 1 ? 1 : 0);
  });
  expect(atlas.readBytes()).toBe(0); atlas.flush(1);
  const replacement = labels[0].texture.source, replaced = vi.fn(); replacement.on('destroy', replaced);
  expect(replacement).not.toBe(source);
  atlas.flush(2); expect(replaced).toHaveBeenCalledOnce();
  expect(labels.every(label => label.texture.source.resolution === 2)).toBe(true);
  const lastSources = new Set(labels.map(label => label.texture.source)), finalDestroyed = vi.fn();
  for (const current of lastSources) current.on('destroy', finalDestroyed);
  for (const label of labels) atlas.remove(label);
  expect(finalDestroyed).toHaveBeenCalledTimes(lastSources.size); expect(atlas.readBytes()).toBe(0);
  expect(atlas.readStats()).toMatchObject({ identityPages: 0, identityEntries: 0, identityActiveLabels: 0 });
});
