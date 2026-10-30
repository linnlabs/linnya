import { inject, provide, type InjectionKey } from 'vue';
import type { createEditingCommands } from '../orchestration/useEditingCommands';

type Port = ReturnType<typeof createEditingCommands>;
const key: InjectionKey<Port> = Symbol('slides-editingCommands');

/** 所有入口共享一次会话，busy 和文稿切换 watcher 不能随按钮重复创建。 */
export function provideEditingCommands(port: Port): void { provide(key, port); }
export function useEditingCommands(): Port {
  const port = inject(key);
  if (!port) throw new Error('Slides editingCommands requires a document surface');
  return port;
}
