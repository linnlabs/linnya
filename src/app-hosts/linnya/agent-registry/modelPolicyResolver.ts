/**
 * @file src/app-hosts/linnya/agent-registry/modelPolicyResolver.ts
 *
 * @description
 * 模型选择策略解析器（仅用于后端）：把 AgentRegistry 中声明式的 modelPolicy
 * 转换为具体的 modelId（在具备足够上下文时）。
 *
 * 约束：
 * - 严禁使用 any；边界输入用 unknown/可选字段，并通过类型守卫收敛；
 * - 本模块只负责“解析策略”，不负责“如何获取上下文”。
 */

import type { AgentConfiguration } from './types';

export type ModelPolicyResolveContext = {
  /**
   * 历史视觉模型 ID（legacy kb.visionModelId）
   *
   * 说明：internals/ingestion/* 这类任务依赖视觉模型。
   */
  kbVisionModelId?: string | null;

  /**
   * PDF OCR 模型 ID。新前端通过请求快照传入，旧 KB 字段仅作为兼容上下文。
   */
  kbPdfOcrModelId?: string | null;

  /**
   * 图片视觉模型 ID。新前端通过请求快照传入，旧 KB 字段仅作为兼容上下文。
   */
  kbImageVisionModelId?: string | null;

  /**
   * 静态兜底视觉模型 ID。
   *
   * 说明：
   * - 当 kbVisionModelId 为空时作为兜底；
   * - 让调用方“只调用 resolver 就能拿到最终 modelId”，避免在各处重复写 `|| DEFAULT...`。
   */
  defaultVisionModelId?: string;

  /**
   * 按能力解析模型 ID（由调用方提供）
   *
   * 说明：
   * - 保持 resolver 无隐式依赖（不直接 import Model Catalog）；
   * - 调用方可用 registry.getModelsByCapability(...) 生成一个 resolverFn 传入。
   */
  resolveByCapability?: (capability: string) => string | undefined;
};

export function resolveModelIdFromPolicy(
  policy: AgentConfiguration['modelPolicy'] | undefined,
  ctx: ModelPolicyResolveContext
): string | undefined {
  if (!policy) return undefined;

  if (policy.kind === 'fixed') {
    const id = policy.modelId;
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined;
  }

  if (policy.kind === 'kb_vision') {
    const id = ctx.kbVisionModelId;
    if (typeof id === 'string' && id.trim().length > 0) return id.trim();
    const fallback = ctx.defaultVisionModelId;
    return typeof fallback === 'string' && fallback.trim().length > 0 ? fallback.trim() : undefined;
  }

  if (policy.kind === 'kb_pdf_ocr') {
    const id = ctx.kbPdfOcrModelId;
    if (typeof id === 'string' && id.trim().length > 0) return id.trim();

    const resolverFn = ctx.resolveByCapability;
    const capability = policy.defaultCapability;
    const capabilityDefault =
      typeof resolverFn === 'function' && typeof capability === 'string'
        ? resolverFn(capability)
        : undefined;
    if (typeof capabilityDefault === 'string' && capabilityDefault.trim().length > 0) {
      return capabilityDefault.trim();
    }

    const fallback = ctx.defaultVisionModelId;
    return typeof fallback === 'string' && fallback.trim().length > 0 ? fallback.trim() : undefined;
  }

  if (policy.kind === 'kb_image_vision') {
    const id = ctx.kbImageVisionModelId;
    if (typeof id === 'string' && id.trim().length > 0) return id.trim();

    const legacy = ctx.kbVisionModelId;
    if (typeof legacy === 'string' && legacy.trim().length > 0) return legacy.trim();

    const fallback = ctx.defaultVisionModelId;
    return typeof fallback === 'string' && fallback.trim().length > 0 ? fallback.trim() : undefined;
  }

  // user_primary / user_auxiliary / inherit_parent / by_capability：
  // - 后端在这里没有“用户模型选择 store”的上下文；
  // - inherit_parent 只在 registered child-run 编排中结合父 ToolContext 解析；
  // - by_capability 需要结合 Model Catalog 才能解析，这里保持纯函数，不做隐式依赖。
  if (policy.kind === 'by_capability') {
    const resolverFn = ctx.resolveByCapability;
    return typeof resolverFn === 'function' ? resolverFn(policy.capability) : undefined;
  }
  return undefined;
}
