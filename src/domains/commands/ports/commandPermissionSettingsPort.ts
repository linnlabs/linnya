export type CommandPermissionSettingsDocumentReadResult =
  | { readonly status: 'missing' }
  | { readonly status: 'found'; readonly serialized: string }
  | { readonly status: 'failed'; readonly message: string };

export type CommandPermissionSettingsDocumentWriteResult =
  | { readonly status: 'written' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * 权限设置的唯一持久化端口只读写完整文档，不解释默认值、版本或权限语义。
 * 这些规则留在 Commands domain，避免文件 adapter 成为第二个设置真源。
 */
export interface CommandPermissionSettingsPort {
  read(): CommandPermissionSettingsDocumentReadResult;
  write(serialized: string): CommandPermissionSettingsDocumentWriteResult;
}
