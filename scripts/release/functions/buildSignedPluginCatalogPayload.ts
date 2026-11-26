import {
  SignedPluginCatalogPayloadSchema,
  type PluginCatalogChannel,
  type PluginRuntimeEntry,
  type SignedPluginCatalogEntry,
  type SignedPluginCatalogPayload,
} from '../../../packages/schemas/src/plugins/catalog.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 与 Host 验签上限一致；超过会被 Desktop 拒绝，发布前就失败。 */
export const MAX_PLUGIN_CATALOG_VALID_DAYS = 90;

/**
 * 生成待签名的 catalog payload。签名在受保护的发布环境完成，本函数只组装与校验数据；
 * 序号由发布方给出且必须大于已发布的 catalog（由签名工具对照线上版本核对）。
 */
export function buildSignedPluginCatalogPayload(input: {
  readonly channel: PluginCatalogChannel;
  readonly sequence: number;
  readonly issuedAt: Date;
  readonly validDays: number;
  readonly plugins: readonly SignedPluginCatalogEntry[];
  readonly runtimes?: readonly PluginRuntimeEntry[];
}): SignedPluginCatalogPayload {
  if (!Number.isInteger(input.validDays) || input.validDays < 1 || input.validDays > MAX_PLUGIN_CATALOG_VALID_DAYS) {
    throw new Error(`catalog 有效期必须是 1–${MAX_PLUGIN_CATALOG_VALID_DAYS} 天: ${input.validDays}`);
  }
  // 签发时间取整到秒，保持 UTC ISO 规范形式，便于人工核对。
  const issuedAt = new Date(Math.floor(input.issuedAt.getTime() / 1000) * 1000);
  return SignedPluginCatalogPayloadSchema.parse({
    schemaVersion: 1,
    channel: input.channel,
    sequence: input.sequence,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + input.validDays * DAY_MS).toISOString(),
    plugins: input.plugins,
    runtimes: input.runtimes ?? [],
    revoked: [],
  });
}
