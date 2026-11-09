import { computed, shallowRef } from 'vue';
import { expect, it, vi } from 'vitest';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasPageCommandSurface } from '../../definitions/canvasPageCommands';
import { canvasColorMenuOptions, canvasContextMenuActions } from '../../functions/canvasMenuActions';
import { createCanvasPageCommands } from '../createCanvasPageCommands';

function leaves(options: readonly CustomSelectOption<string>[]): string[] {
  return options.flatMap(option => option.children ? leaves(option.children) : typeof option.value === 'string' ? [option.value] : []);
}
function fixture() {
  const color = vi.fn(async () => {}), arrange = vi.fn(async () => {}), close = vi.fn(), edgePatch = vi.fn(async () => {});
  const surface: CanvasPageCommandSurface = {
    context: shallowRef(null), createText: async () => {}, fit: () => {}, edit: async () => {}, remove: async () => {}, select: async () => {}, arrange, color, closeContext: close, locateEndpoint: () => {},
    actions: { duplicate: async () => {}, lock: async () => {}, layer: async () => {}, align: async () => {}, distribute: async () => {} },
    clipboard: { copy: async () => {}, cut: async () => {}, paste: async () => {} },
    connections: { selected: computed(() => null), patch: edgePatch, reverse: async () => {}, beginLabel: async () => {} },
    session: { state: { snapshot: shallowRef(null) } },
  };
  const command = createCanvasPageCommands({ readSurface: () => surface, addToConversation: async () => {}, showDocuments: async () => {}, pickImages: () => {} });
  return { color, arrange, close, edgePatch, command };
}
it('单卡、多选、空白与只读菜单分别暴露适用入口，子菜单颜色共用同一合同', () => {
  const single = canvasContextMenuActions({ selectionCount: 1, edge: false, readonly: false });
  const multiple = canvasContextMenuActions({ selectionCount: 3, edge: false, readonly: false });
  const empty = canvasContextMenuActions({ selectionCount: 0, edge: false, readonly: false });
  expect(leaves(single)).toEqual(expect.arrayContaining(canvasColorMenuOptions.map(option => option.value)));
  expect(leaves(single)).not.toContain('arrange');
  expect(multiple.find(option => option.value === 'arrange')?.text).toBe('自动排布所选');
  expect(empty.find(option => option.value === 'arrange')?.text).toBe('自动排布');
  const readonly = leaves(canvasContextMenuActions({ selectionCount: 3, edge: false, readonly: true }));
  expect(readonly).toContain('copy'); expect(readonly).not.toContain('arrange'); expect(readonly.some(value => value.startsWith('color:'))).toBe(false);
});
it('选择颜色与排布菜单最终调用已有正式表面动作，未知值不关闭菜单或产生修改', async () => {
  const f = fixture(); await f.command('color:red');
  expect(f.color).toHaveBeenCalledExactlyOnceWith('red'); expect(f.edgePatch).not.toHaveBeenCalled();
  await f.command('arrange'); expect(f.arrange).toHaveBeenCalledExactlyOnceWith({ algorithm: 'tree', direction: 'right' });
  expect(f.close).toHaveBeenCalledTimes(2);
  await expect(f.command('color:magenta')).rejects.toThrow('未知画布菜单动作'); expect(f.color).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledTimes(2);
});
it('纯图片选区的右键菜单不给颜色：图片铺满纸面，纸色看不见', () => {
  const image = leaves(canvasContextMenuActions({ selectionCount: 1, colorable: false, edge: false, readonly: false }));
  const text = leaves(canvasContextMenuActions({ selectionCount: 1, colorable: true, edge: false, readonly: false }));
  expect(image.some(value => value.startsWith('color:'))).toBe(false);
  expect(text.some(value => value.startsWith('color:'))).toBe(true);
  expect(image).toContain('delete');
});
