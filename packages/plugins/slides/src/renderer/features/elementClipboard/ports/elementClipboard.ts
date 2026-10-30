import { inject, provide, type InjectionKey } from 'vue';
import type { createElementClipboard } from '../orchestration/useElementClipboard';

type Port = ReturnType<typeof createElementClipboard>;
const key: InjectionKey<Port> = Symbol('slides-elementClipboard');

/** 所有入口共享一次会话，busy 和文稿切换 watcher 不能随按钮重复创建。 */
export function provideElementClipboard(port: Port): void { provide(key, port); }
export function useElementClipboard(): Port {
  const port = inject(key);
  if (!port) throw new Error('Slides elementClipboard requires a document surface');
  return port;
}
