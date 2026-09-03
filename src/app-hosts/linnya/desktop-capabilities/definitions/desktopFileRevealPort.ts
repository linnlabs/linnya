/** Backend 已完成路径准入后，Desktop 只负责调用系统文件管理器显示目标。 */
export interface DesktopFileRevealPort {
  revealInFileManager(absolutePath: string): Promise<void>;
}
