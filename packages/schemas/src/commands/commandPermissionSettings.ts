import { z } from 'zod';

import { CommandAgentRunIdSchema } from './commandIdentity';
import { COMMAND_RUNTIME_PROTOCOL_VERSION } from './commandExecution';
import {
  CommandInternalDataAccessSchema,
  CommandPermissionLevelSchema,
} from './commandPermission';

export const COMMAND_PERMISSION_SETTINGS_SCHEMA_VERSION = 1 as const;

export const CommandGuiControlPolicySchema = z.literal('denied');
export type CommandGuiControlPolicy = z.infer<typeof CommandGuiControlPolicySchema>;

export const CommandLocalIpcControlPolicySchema = z.literal('denied');
export type CommandLocalIpcControlPolicy = z.infer<
  typeof CommandLocalIpcControlPolicySchema
>;

export const CommandProcessLifecyclePolicySchema = z.literal('terminate_with_run');
export type CommandProcessLifecyclePolicy = z.infer<
  typeof CommandProcessLifecyclePolicySchema
>;

/**
 * 全局设置文件的完整文档。固定能力也写入文档，避免平台 adapter 根据隐式默认值
 * 各自解释 GUI、IPC 或后台进程边界。
 */
export const CommandPermissionSettingsV1Schema = z.object({
  schema_version: z.literal(COMMAND_PERMISSION_SETTINGS_SCHEMA_VERSION),
  kind: z.literal('command_permission_settings'),
  revision: z.number().int().nonnegative().safe(),
  permission_level: CommandPermissionLevelSchema,
  internal_data_access: CommandInternalDataAccessSchema,
  gui_control: CommandGuiControlPolicySchema,
  local_ipc_control: CommandLocalIpcControlPolicySchema,
  process_lifecycle: CommandProcessLifecyclePolicySchema,
}).strict();
export type CommandPermissionSettingsV1 = z.infer<
  typeof CommandPermissionSettingsV1Schema
>;

/** 用户可修改的两项事实。其余字段当前是固定产品合同，不能由隐藏入口改写。 */
export const CommandPermissionSettingsUpdateV1Schema = z.object({
  schema_version: z.literal(COMMAND_PERMISSION_SETTINGS_SCHEMA_VERSION),
  kind: z.literal('command_permission_settings_update'),
  expected_revision: z.number().int().nonnegative().safe(),
  permission_level: CommandPermissionLevelSchema,
  internal_data_access: CommandInternalDataAccessSchema,
}).strict();
export type CommandPermissionSettingsUpdateV1 = z.infer<
  typeof CommandPermissionSettingsUpdateV1Schema
>;

export const COMMAND_PERMISSION_SETTINGS_READ_CHANNEL =
  'command-permission-settings:read' as const;
export const COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL =
  'command-permission-settings:update' as const;

export const CommandPermissionSettingsReadResultV1Schema = z.discriminatedUnion(
  'success',
  [
    z.object({
      success: z.literal(true),
      settings: CommandPermissionSettingsV1Schema,
    }).strict(),
    z.object({
      success: z.literal(false),
      code: z.enum(['invalid_config', 'read_failed']),
    }).strict(),
  ],
);
export type CommandPermissionSettingsReadResultV1 = z.infer<
  typeof CommandPermissionSettingsReadResultV1Schema
>;

const CommandPermissionSettingsUpdateFailureCodeSchema = z.enum([
  'invalid_update',
  'invalid_config',
  'read_failed',
]);

/**
 * revision conflict 与写入失败必须带回重新读取的 backend 事实。renderer 只能保留
 * 用户草稿并让用户再次确认，不能依据本地旧值猜测持久化结果或自动重试。
 */
export const CommandPermissionSettingsUpdateResultV1Schema = z.union([
  z.object({
    success: z.literal(true),
    settings: CommandPermissionSettingsV1Schema,
  }).strict(),
  z.object({
    success: z.literal(false),
    code: CommandPermissionSettingsUpdateFailureCodeSchema,
  }).strict(),
  z.object({
    success: z.literal(false),
    code: z.literal('revision_conflict'),
    settings: CommandPermissionSettingsV1Schema,
  }).strict(),
  z.object({
    success: z.literal(false),
    code: z.literal('write_failed'),
    settings: CommandPermissionSettingsV1Schema,
  }).strict(),
]);
export type CommandPermissionSettingsUpdateResultV1 = z.infer<
  typeof CommandPermissionSettingsUpdateResultV1Schema
>;

/**
 * 一次根 run 启动时冻结的权限。child run 继承该对象，不重新读取全局设置。
 * command execution 创建 proposal 时，再把这些值投影到绑定 execution identity 的
 * CommandPermissionSnapshotV1，两个生命周期不能混成同一个 DTO。
 */
export const CommandRunPermissionSnapshotV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_run_permission_snapshot'),
  root_agent_run_id: CommandAgentRunIdSchema,
  settings_revision: z.number().int().nonnegative().safe(),
  captured_at_ms: z.number().int().nonnegative().safe(),
  permission_level: CommandPermissionLevelSchema,
  internal_data_access: CommandInternalDataAccessSchema,
  gui_control: CommandGuiControlPolicySchema,
  local_ipc_control: CommandLocalIpcControlPolicySchema,
  process_lifecycle: CommandProcessLifecyclePolicySchema,
}).strict();
export type CommandRunPermissionSnapshotV1 = z.infer<
  typeof CommandRunPermissionSnapshotV1Schema
>;

export function parseCommandPermissionSettings(
  value: unknown,
): CommandPermissionSettingsV1 {
  return CommandPermissionSettingsV1Schema.parse(value);
}

export function parseCommandPermissionSettingsUpdate(
  value: unknown,
): CommandPermissionSettingsUpdateV1 {
  return CommandPermissionSettingsUpdateV1Schema.parse(value);
}

export function parseCommandRunPermissionSnapshot(
  value: unknown,
): CommandRunPermissionSnapshotV1 {
  return CommandRunPermissionSnapshotV1Schema.parse(value);
}
