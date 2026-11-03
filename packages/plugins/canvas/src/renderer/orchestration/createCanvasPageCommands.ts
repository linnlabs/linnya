import type { createCanvasSurface } from './createCanvasSurface';
import type { CanvasPoint } from '@plugin/canvas/shared';
type Surface = Awaited<ReturnType<typeof createCanvasSurface>>;
export function createCanvasPageCommands(options: { readSurface(): Surface | null; addToConversation(): Promise<void>; showDocuments(point?: CanvasPoint): Promise<void>; pickImages(point?: CanvasPoint): void }) {
  const commands = new Map<string, (surface: Surface) => void | Promise<unknown>>([
    ['ai', () => options.addToConversation()], ['new', surface => surface.createText(surface.context.value?.point)], ['document', surface => options.showDocuments(surface.context.value?.point)], ['image', surface => options.pickImages(surface.context.value?.point)],
    ['fit', surface => surface.fit()], ['edit', surface => surface.edit()], ['duplicate', surface => surface.actions.duplicate()], ['copy', surface => surface.clipboard.copy()], ['cut', surface => surface.clipboard.cut()], ['paste', surface => surface.clipboard.paste()],
    ['lock', surface => surface.actions.lock()], ['front', surface => surface.actions.layer('front')], ['back', surface => surface.actions.layer('back')],
    ['left', surface => surface.actions.align('left')], ['center-x', surface => surface.actions.align('center-x')], ['right', surface => surface.actions.align('right')],
    ['top', surface => surface.actions.align('top')], ['center-y', surface => surface.actions.align('center-y')], ['bottom', surface => surface.actions.align('bottom')],
    ['grid', surface => surface.actions.align('grid')], ['distribute-x', surface => surface.actions.distribute('horizontal')], ['distribute-y', surface => surface.actions.distribute('vertical')], ['delete', surface => surface.remove()],
    ['fit-selection', surface => surface.fit(true)], ['select-all', surface => surface.select(surface.session.state.snapshot.value?.elements.flatMap(element => element.type === 'edge' ? [] : [element.id]) ?? [])],
    ['arrange', surface => surface.arrange({ algorithm: 'tree', direction: 'right' })],
    ['reverse', surface => surface.connections.reverse()], ['label', surface => surface.connections.beginLabel()],
    ['jump-from', surface => surface.locateEndpoint('from')], ['jump-to', surface => surface.locateEndpoint('to')],
  ]);
  return async (value: string | number | boolean) => {
    const current = options.readSurface(); if (!current) return;
    const command = typeof value === 'string' ? commands.get(value) : undefined;
    if (!command) throw new Error('未知画布菜单动作'); await command(current); current.closeContext();
  };
}
