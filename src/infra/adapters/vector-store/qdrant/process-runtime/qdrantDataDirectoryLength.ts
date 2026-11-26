import type { QdrantProcessRuntime } from './qdrantProcessRuntime';

/**
 * Windows 上 Qdrant 数据目录（QdrantManager 传给 Qdrant 的工作目录，`storage/` 的父目录）允许的最大字符数。
 *
 * 为什么要限制：随包 Qdrant 1.14.1 用 RocksDB 存负载索引，RocksDB 用 `/` 拼接路径、不支持长路径，
 * 文件完整路径超过 Windows 260 字符上限时，建集合直接返回 HTTP 500（os error 3）。加 `\\?\` 前缀后
 * RocksDB 打不开 payload_index/LOG，Qdrant 的 payload_index_skip_rocksdb 开关在超长目录下同样失败，
 * 所以只能在启动前按目录长度拦住，避免进程起来后建集合半途失败。
 *
 * 取值依据（2026-11-24 Windows 11 虚拟机，Qdrant 1.14.1，产品配置与建集合参数，逐长度实测
 * 建集合、写 4000 点、建索引、删除、检索、重启）：
 * - 正文集合（集合名是 36 字符的知识库 ID）：目录 109 通过、110 失败；
 * - 图谱集合（集合名再加 `kg_nodes_` / `kg_edges_` 前缀，共 45 字符）：目录 100 通过、101 失败。
 * 两组都等价于“目录 + 集合名 ≤ 145”，失败都发生在建集合时。取较严的 100，保证一个知识库的全部集合都能建成，
 * 不让用户落到“正文能建、图谱建不成”的半可用状态。
 *
 * 正式版默认目录 `%LOCALAPPDATA%\linnya\Workspace\Plugins\knowledge\qdrant` 约 65 + 用户目录名长度，
 * 旧资料沿用的 `KnowledgeBase\qdrant` 约 61 + 用户目录名长度；通常只有 LINNYA_WORKSPACE_DIR 指到很深的目录才会超限。
 * 升级 Qdrant 或改动集合命名时必须重新实测这个值。
 */
export const WINDOWS_QDRANT_DATA_DIRECTORY_MAX_LENGTH = 100;

/** 数据目录超过 Windows 上 Qdrant 能建集合的长度；改目录后重启才能恢复，停启插件无效。 */
export class QdrantDataDirectoryTooLongError extends Error {
  constructor(
    readonly dataDirectory: string,
    readonly maxLength: number,
  ) {
    super(`Qdrant 数据目录长度 ${dataDirectory.length} 超过 Windows 上限 ${maxLength}：${dataDirectory}`);
    this.name = 'QdrantDataDirectoryTooLongError';
  }
}

/**
 * 在创建任何目录或文件之前调用，超限时不启动 Qdrant、不写入。
 * 只在 Windows 判断：macOS 路径上限 1024，同样的目录不受影响。长度按 UTF-16 字符计，与 Windows 路径上限的口径一致。
 */
export function assertQdrantDataDirectoryLength(
  platform: QdrantProcessRuntime['platform'],
  dataDirectory: string,
): void {
  if (platform === 'win32' && dataDirectory.length > WINDOWS_QDRANT_DATA_DIRECTORY_MAX_LENGTH) {
    throw new QdrantDataDirectoryTooLongError(dataDirectory, WINDOWS_QDRANT_DATA_DIRECTORY_MAX_LENGTH);
  }
}
