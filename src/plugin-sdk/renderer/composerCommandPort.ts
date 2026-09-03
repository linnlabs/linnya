/**
 * @file composerCommandPort.ts
 * @description 插件从页面交互操作 conversation composer 引用的窄门面。
 *
 * 这里只暴露引用增删命令，不暴露 composer store、编辑器实例或输入框模式控制。
 * 真实实现由 app 层绑定 conversation feature。
 */

import type {
  ComposerCommandReferenceInput,
  RendererComposerCommandPort,
} from '@linnya/plugin-host-contract/renderer/composerCommandPort';

export type {
  ComposerCommandReferenceInput,
  RendererComposerCommandPort,
} from '@linnya/plugin-host-contract/renderer/composerCommandPort';

let activePort: RendererComposerCommandPort | undefined;

export function registerRendererComposerCommandPort(port: RendererComposerCommandPort): void {
  if (activePort) {
    throw new Error('[renderer-composer-command-port] composer command port 重复注册');
  }
  activePort = port;
}

export function clearRendererComposerCommandPortForTest(): void {
  activePort = undefined;
}

function requireRendererComposerCommandPort(): RendererComposerCommandPort {
  if (!activePort) {
    throw new Error('[renderer-composer-command-port] composer command port 尚未注册');
  }
  return activePort;
}

export function addComposerReference(input: ComposerCommandReferenceInput): string {
  return requireRendererComposerCommandPort().addReference(input);
}

export function removeComposerReference(referenceId: string): void {
  requireRendererComposerCommandPort().removeReference(referenceId);
}
