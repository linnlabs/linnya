import fs from 'node:fs';
import path from 'node:path';

import {
  PLUGIN_CATALOG_CHANNELS,
  PluginCatalogRevocationSchema,
  type PluginCatalogChannel,
  type PluginCatalogRevocation,
} from '@app/schemas';
import { z } from 'zod';

import type { PluginCatalogHighWaterMark, VerifiedPluginCatalog } from '../definitions/pluginCatalog';

/** 普通文件放在用户插件根下；插件发现只认带 active.json 的子目录，不会把它当成插件。 */
export const PLUGIN_CATALOG_STATE_FILE_NAME = '.catalog-state.json';

const AcceptedSchema = z.object({
  sequence: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  keyId: z.string().min(1),
  acceptedAt: z.string().min(1),
  /** 最近一份已接受 catalog 的撤回列表；启动准入据此撤销旧回执对应的版本。 */
  revoked: z.array(PluginCatalogRevocationSchema).default([]),
}).strict();

const StateSchema = z.object({
  schemaVersion: z.literal(1),
  channels: z.partialRecord(z.enum(PLUGIN_CATALOG_CHANNELS), AcceptedSchema),
}).strict();

type CatalogState = z.infer<typeof StateSchema>;

export interface PluginCatalogStateStore {
  readHighWaterMark(channel: PluginCatalogChannel): PluginCatalogHighWaterMark | null;
  /** 所有通道最近一份已接受 catalog 的撤回项合集。 */
  readRevocations(): readonly PluginCatalogRevocation[];
  /** 只前进不后退：较小序号的记录不会覆盖已知更高的记录。 */
  recordAccepted(catalog: VerifiedPluginCatalog, acceptedAt: Date): void;
}

export function createPluginCatalogStateStore(input: {
  readonly userPluginRoot: string;
  readonly recordDiagnostic?: (message: string) => void;
}): PluginCatalogStateStore {
  const statePath = path.join(input.userPluginRoot, PLUGIN_CATALOG_STATE_FILE_NAME);

  const read = (): CatalogState => {
    if (!fs.existsSync(statePath)) return { schemaVersion: 1, channels: {} };
    try {
      return StateSchema.parse(JSON.parse(fs.readFileSync(statePath, 'utf8')));
    } catch (error) {
      // 写入是原子替换，损坏只可能来自本机外部改动；按“未接受过”处理并留诊断，不让远程安装永久失效。
      input.recordDiagnostic?.(`插件 catalog 本机状态无法读取，按首次接受处理: ${error instanceof Error ? error.message : String(error)}`);
      return { schemaVersion: 1, channels: {} };
    }
  };

  return {
    readHighWaterMark(channel) {
      const accepted = read().channels[channel];
      return accepted ? { sequence: accepted.sequence, digest: accepted.digest } : null;
    },
    readRevocations() {
      return Object.values(read().channels).flatMap(accepted => accepted?.revoked ?? []);
    },
    recordAccepted(catalog, acceptedAt) {
      const state = read();
      const current = state.channels[catalog.channel];
      if (current && current.sequence > catalog.sequence) return;
      const next: CatalogState = {
        schemaVersion: 1,
        channels: {
          ...state.channels,
          [catalog.channel]: {
            sequence: catalog.sequence,
            digest: catalog.digest,
            keyId: catalog.keyId,
            acceptedAt: acceptedAt.toISOString(),
            revoked: catalog.revoked.map(item => ({ kind: item.kind, id: item.id, version: item.version })),
          },
        },
      };
      fs.mkdirSync(input.userPluginRoot, { recursive: true });
      const tempPath = path.join(input.userPluginRoot, `.catalog-state.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, statePath);
    },
  };
}
