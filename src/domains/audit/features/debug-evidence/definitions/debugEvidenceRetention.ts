/**
 * 开发态 LLM debug evidence 的文件保留合同。
 *
 * 这些限制是代码合同，不开放为环境变量，避免不同入口各自改变审计容量。
 */
export const DEBUG_EVIDENCE_RETENTION_DAYS = 7;
export const DEBUG_EVIDENCE_MAX_DIRECTORY_BYTES = 256 * 1024 * 1024;
export const DEBUG_EVIDENCE_MAX_RUN_FILE_BYTES = 16 * 1024 * 1024;

export const DEBUG_EVIDENCE_RETENTION_MS = DEBUG_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const DEBUG_EVIDENCE_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
