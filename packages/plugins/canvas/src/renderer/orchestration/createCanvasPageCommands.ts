import type { createCanvasSurface } from './createCanvasSurface';
type Surface = Awaited<ReturnType<typeof createCanvasSurface>>;
export function createCanvasPageCommands(options: { readSurface(): Surface | null; addToConversation(): Promise<void>; showDocuments(): Promise<void>; pickImages(): void }) {
  const commands = new Map<string, (surface: Surface) => void | Promise<unknown>>([
    ['ai', () => options.addToConversation()], ['new', surface => surface.createText(surface.context.value?.point)], ['document', () => options.showDocuments()], ['image', () => options.pickImages()],
    ['fit', surface => surface.fit()], ['edit', surface => surface.edit()], ['duplicate', surface => surface.actions.duplicate()], ['copy', surface => surface.clipboard.copy()], ['cut', surface => surface.clipboard.cut()], ['paste', surface => surface.clipboard.paste()],
    ['lock', surface => surface.actions.lock()], ['front', surface => surface.actions.layer('front')], ['back', surface => surface.actions.layer('back')],
    ['left', surface => surface.actions.align('left')], ['top', surface => surface.actions.align('top')], ['grid', surface => surface.actions.align('grid')], ['delete', surface => surface.remove()],
  ]);
  return async (value: string | number | boolean) => {
    const current = options.readSurface(); if (!current) return;
    const command = typeof value === 'string' ? commands.get(value) : undefined;
    if (!command) throw new Error('未知画布菜单动作'); await command(current); current.closeContext();
  };
}
