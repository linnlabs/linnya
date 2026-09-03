export const DESKTOP_FILE_REVEAL_RPC_METHOD = 'desktop.file_reveal.show_item' as const;

export interface DesktopFileRevealRpcRequest {
  readonly absolutePath: string;
}
