import {
  SHELL_HARD_TIMEOUT_DEFAULT_SECONDS,
  SHELL_HARD_TIMEOUT_MAX_SECONDS,
} from '@app/schemas/commands';
import { COMMAND_MAXIMUM_ACTIVE_EXECUTIONS } from 'src/domains/commands';
import type { CommandConstructionPolicy } from './commandConstructionPolicy';

/** 已完成验证的 Linnya 产品施工事实；宿主 adapter 和单次 route 均不能覆盖。 */
export const LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY: CommandConstructionPolicy =
  Object.freeze({
    defaultHardTimeoutMs: SHELL_HARD_TIMEOUT_DEFAULT_SECONDS * 1_000,
    maximumHardTimeoutMs: SHELL_HARD_TIMEOUT_MAX_SECONDS * 1_000,
    maximumActiveExecutions: COMMAND_MAXIMUM_ACTIVE_EXECUTIONS,
  });
