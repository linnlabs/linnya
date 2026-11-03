import type { AuditLevel } from '../../definitions/auditLevel';
import type { AuditLevelState } from '../../definitions/auditRuntime';

/** 只保存本实例的新 run 默认值，不写环境变量或用户设置。 */
export function createAuditLevelState(initialLevel: AuditLevel): AuditLevelState {
  let level = initialLevel;
  return {
    get level() {
      return level;
    },
    setLevel(value) {
      level = value;
    },
  };
}
