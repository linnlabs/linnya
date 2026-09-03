import type {
  CommandOutputArtifactMaintenanceRequest,
  CommandOutputArtifactMaintenanceStats,
} from '../definitions/commandOutputArtifactMaintenance';

/**
 * 原始输出的保留期由每份已封口 manifest 自己冻结。维护端口只负责执行这个事实，
 * 不读取全局设置，也不与 Agent 文本、对话目录或任意 CLI 的存储管理混在一起。
 */
export interface CommandOutputArtifactMaintenancePort {
  cleanupExpired(
    request: CommandOutputArtifactMaintenanceRequest,
  ): Promise<CommandOutputArtifactMaintenanceStats>;
}
