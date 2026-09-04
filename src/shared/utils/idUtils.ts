/**
 * @file src/shared/utils/idUtils.ts
 * 
 * **功能 (What):** 提供一个中心化的ID生成工具，确保系统中所有ID的生成逻辑统一、稳定且可维护。
 * 
 * **输入 (Input):** 根据不同函数接收文件字节数组、文档ID、块索引等参数
 * 
 * **输出 (Output):** 返回格式化的、确定性的或随机的唯一标识符字符串
 * 
 * **副作用 (Side-effects):** 无副作用，纯函数实现
 */

import crypto from 'crypto';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

// --- 关键：为确定性ID定义一个固定的命名空间 ---
// 这个UUID是随机生成的，但它在代码中必须是固定的。
// 使用UUIDv5时，相同的命名空间和相同的名称将始终产生相同的UUID。
const DETERMINISTIC_NAMESPACE = 'f3f4a9d4-1a39-4467-b52b-7c85b6b3b5d7';

/**
 * **功能 (What):** 根据文件的二进制内容生成一个唯一的、稳定的文档ID
 * 
 * **输入 (Input / @param):** 
 * @param fileBytes - 文件的原始二进制内容 (Buffer)
 * 
 * **输出 (Output / @returns):** 一个格式为 "doc-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，纯函数
 * 
 * @description
 * 这种方法的核心优势是ID与文件内容绑定，而不是文件名。
 * 即使用户重命名文件，只要内容不变，ID就保持不变，从而避免了重复入库。
 * [V60] 格式与前端对齐，采用 "prefix-hash" 格式。
 */
export function generateDocId(fileBytes: Buffer): string {
  // 使用 SHA256 算法，它具有极高的抗碰撞性
  const fileHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
  // 取哈希值的前32个字符（128位），足以保证在实际应用中几乎不可能发生碰撞
  return `doc-${fileHash.slice(0, 32)}`;
}

/**
 * **功能 (What):** 为文档中的一个块（block）生成一个唯一的、确定性的ID
 * 
 * **输入 (Input / @param):** 
 * @param docId - 该块所属文档的ID
 * @param blockIndex - 该块在文档中的顺序索引（从0开始）
 * @param blockText - 该块的文本内容
 * 
 * **输出 (Output / @returns):** 一个32位的十六进制字符串，作为 Qdrant 的 Point ID
 * 
 * **副作用 (Side-effects):** 无副作用，纯函数
 * 
 * @description
 * 确定性意味着只要输入（doc_id, index, text）相同，输出的block_id就永远相同。
 * 这对于重新入库或更新操作至关重要。
 * [V62 修复] ID 格式必须是 Qdrant 接受的有效 UUID。
 */
export function generateBlockId(docId: string, blockIndex: number, blockText: string): string {
  // 构建一个能唯一代表该块的字符串
  const uniqueName = `${docId}-${blockIndex}-${blockText}`;
  
  // 🔥 修复：使用UUIDv5，返回完整的带连字符的UUID格式
  // Qdrant 要求 point ID 必须是完整的 UUID 或无符号整数，不能是去掉连字符的字符串
  return uuidv5(uniqueName, DETERMINISTIC_NAMESPACE);
}

/**
 * **功能 (What):** 为“切分后的子块”生成一个稳定且合法的点ID（UUID）
 *
 * **输入 (Input / @param):**
 * @param parentBlockId - 父块ID（必须是一个稳定字符串，建议为父块的 UUID）
 * @param partIndex - 子块序号（从0开始）
 *
 * **输出 (Output / @returns):** RFC4122 UUID 字符串
 *
 * **副作用 (Side-effects):** 无副作用，纯函数
 *
 * @description
 * - 切分子块 ID 不能使用 `${parentId}#${idx}` 这类拼接字符串：Qdrant 只接受 UUID/无符号整数
 * - 这里使用 UUIDv5 保证确定性：同一父块 + 同一序号 永远生成同一 UUID
 */
export function generateSubBlockId(parentBlockId: string, partIndex: number): string {
  const parent = parentBlockId.trim();
  if (!parent) {
    throw new Error('generateSubBlockId: parentBlockId 不能为空');
  }
  if (!Number.isInteger(partIndex) || partIndex < 0) {
    throw new Error(`generateSubBlockId: partIndex 非法: ${partIndex}`);
  }

  return uuidv5(`${parent}:${partIndex}`, DETERMINISTIC_NAMESPACE);
}

/**
 * **功能 (What):** 为“图谱向量索引”生成一个稳定且合法的 Qdrant 点 ID（UUIDv5）
 *
 * **输入 (Input / @param):**
 * @param kbId - 知识库 ID
 * @param kind - 点的业务类型（节点/边），用于避免跨类型碰撞
 * @param graphId - 图谱内部 ID（例如 node.id / edge.id），可能不是 UUID，但必须稳定
 *
 * **输出 (Output / @returns):** RFC4122 UUID 字符串（Qdrant 可接受）
 *
 * **副作用 (Side-effects):** 无副作用，纯函数
 *
 * @description
 * 根因修复：
 * - 图谱内部的 node.id/edge.id 可能是 `apple` / `edge_xxx` 这类字符串；
 * - Qdrant point id 只接受 UUID 或无符号整数，直接 upsert 会触发 400 Bad Request；
 * - 因此这里用 UUIDv5 将稳定字符串映射为稳定 UUID，保证“幂等覆盖 + 合法格式”两者兼得。
 */
export function generateGraphVectorPointId(
  kbId: string,
  kind: 'kg_node' | 'kg_edge',
  graphId: string
): string {
  const k = kbId.trim();
  const g = graphId.trim();
  if (!k) throw new Error('generateGraphVectorPointId: kbId 不能为空');
  if (!g) throw new Error('generateGraphVectorPointId: graphId 不能为空');
  return uuidv5(`${k}:${kind}:${g}`, DETERMINISTIC_NAMESPACE);
}

/**
 * **功能 (What):** 生成一个用于异步任务的、完全随机的唯一ID
 * 
 * **输入 (Input / @param):** 无参数
 * 
 * **输出 (Output / @returns):** 一个格式为 "task-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机ID
 * 
 * @description
 * [V60] 格式与前端对齐，采用 "prefix-short_hash" 格式。
 * 每次调用都会生成一个全新的、不与任何其他ID重复的ID。
 */
export function generateTaskId(): string {
  // uuidv4() 直接返回一个带连字符的UUID字符串，我们移除连字符并取前12位
  return `task-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * **功能 (What):** 生成一个用于聊天消息的、完全随机的唯一ID
 * 
 * **输入 (Input / @param):** 无参数
 * 
 * **输出 (Output / @returns):** 一个格式为 "msg-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机ID
 */
export function generateMessageId(): string {
  return `msg-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * **功能 (What):** 生成一个用于对话的、完全随机的唯一ID
 * 
 * **输入 (Input / @param):** 无参数
 * 
 * **输出 (Output / @returns):** 一个格式为 "conv-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机ID
 */
export function generateConversationId(): string {
  return `conv-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * **功能 (What):** 生成一个用于对话轮次的、完全随机的唯一ID
 * 
 * **输入 (Input / @param):** 无参数
 * 
 * **输出 (Output / @returns):** 一个格式为 "run-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机ID
 */
export function generateRunId(): string {
  return `run-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * **功能 (What):** 生成一个用于执行流程的、完全随机的唯一ID
 * 
 * **输入 (Input / @param):** 无参数
 * 
 * **输出 (Output / @returns):** 一个格式为 "exec-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机ID
 */
export function generateExecutionId(): string {
  return `exec-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * **功能 (What):** 生成一个用于链路追踪的、完全随机的唯一ID
 * 
 * **输入 (Input / @param):** 无参数
 * 
 * **输出 (Output / @returns):** 一个格式为 "trace-..." 的字符串ID
 * 
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机ID
 */
export function generateTraceId(): string {
  return `trace-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
} 

/**
 * **功能 (What):** 生成与编辑器持久化结构一致的内容块 ID。
 *
 * **输出 (Output / @returns):** 形如 `block-xxxxxxxx` 的短 ID。
 *
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机 ID。
 *
 * @description
 * - Workspace Markdown 文档的持久化 JSON 约定使用短前缀 ID（例如 `root-xxxxxxxx`、`block-xxxxxxxx`）；
 * - 这与知识库使用的确定性 UUID `generateBlockId(docId, index, text)` 是两套不同语义，不能混用；
 * - 后端 Markdown 规范化需要生成与前端编辑器一致的块 ID，因此在 shared 层补充专用函数。
 */
export function generateEditorBlockId(): string {
  return `block-${uuidv4().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * **功能 (What):** 生成与编辑器持久化结构一致的根块 ID。
 *
 * **输出 (Output / @returns):** 形如 `root-xxxxxxxx` 的短 ID。
 *
 * **副作用 (Side-effects):** 无副作用，每次调用生成不同的随机 ID。
 */
export function generateEditorRootBlockId(): string {
  return `root-${uuidv4().replace(/-/g, '').slice(0, 8)}`;
}

/** 为 Markdown 导入边界生成与 Renderer 一致的 Annotation ID。 */
export function generateEditorAnnotationId(): string {
  return `annotation-${uuidv4().replace(/-/g, '').slice(0, 8)}`;
}
