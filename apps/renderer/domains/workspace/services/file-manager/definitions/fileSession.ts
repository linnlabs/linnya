/**
 * 当前激活文件的元信息
 */
export interface FileSessionDescriptor {
  documentId: string;
  displayName?: string | null;
  /**
   * markdown | <plugin-session-type> | ...
   */
  type: string;
  /**
   * 可选附加数据（如项目 ID、父节点 ID 等）
   */
  payload?: Record<string, unknown>;
  /**
   * 当前打开动作的取消信号。
   *
   * 中文说明：这是 file-manager 的生命周期契约，不是 UI 兜底。
   * 当用户快速切换文档时，旧打开动作必须在写入 runtime 前停止。
   */
  openSignal?: AbortSignal;
}

export class FileSessionOpenCancelledError extends Error {
  constructor(session: FileSessionDescriptor) {
    super(`[file-manager] 文件打开动作已取消: ${session.type}:${session.documentId}`);
    this.name = 'FileSessionOpenCancelledError';
  }
}

/**
 * 保存上下文
 */
export interface FileSaveContext {
  reason: SaveReason;
  session: FileSessionDescriptor;
}

/**
 * 支持的保存原因，可根据需要继续扩展
 */
export type SaveReason =
  | 'manual' // 用户主动保存 (Ctrl+S)
  | 'auto' // 自动保存计时器
  | 'view-switch' // 切换视图前
  | 'before-unload' // 关闭应用/窗口
  | 'ai-invoke'; // 在调用 AI 前主动保存，避免前后端文档内容不一致

/**
 * 各文件类型需要实现的接口
 */
export interface FileTypeLifecycleHandler {
  type: string;
  /**
   * 中文说明：重型 surface 需要先完成 handler.open 准备运行时上下文，再切换 filePath 触发挂载。
   * 这是 file lifecycle 的通用时序契约，不属于任何具体插件。
   */
  deferSetFilePathUntilOpen?: boolean;
  /**
   * 打开文件（负责具体的加载逻辑）
   */
  open(session: FileSessionDescriptor): Promise<void>;
  /**
   * 保存快照并由文档 owner 更新 dirty；true 不代表请求期间产生的新输入也已保存。
   */
  save?(context: FileSaveContext): Promise<boolean>;
  /**
   * 可选：关闭时做一些清理
   */
  close?(session: FileSessionDescriptor): Promise<void>;
}

