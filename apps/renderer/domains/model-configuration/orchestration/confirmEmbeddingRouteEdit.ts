import { confirm } from '@shared/composables/confirmDialog';
import type { SettingsMessageResolver } from '@/domains/settings/public';
import {
  peekEmbeddingModelChangeImpactPort,
  type EmbeddingModelChangeImpact,
  type EmbeddingModelChangeImpactPort,
} from '../ports/embeddingModelChangeImpactPort';

type ImpactDependencies = {
  readonly impact?: EmbeddingModelChangeImpactPort | null;
  readonly confirm?: typeof confirm;
};

/** 配置独立于知识库启停；未知影响必须说明，不能把插件未启用或元数据读取失败解释为零影响。 */
async function confirmImpact(
  resolveAffected: (
    port: EmbeddingModelChangeImpactPort
  ) => Promise<readonly EmbeddingModelChangeImpact[]>,
  message: SettingsMessageResolver,
  dependencies: ImpactDependencies
): Promise<boolean> {
  const impact =
    dependencies.impact === undefined ? peekEmbeddingModelChangeImpactPort() : dependencies.impact;
  let detail = message('settings.modelConfig.embedding.editConfirm.unavailable');
  if (impact) {
    let affected: readonly EmbeddingModelChangeImpact[] | undefined;
    try {
      affected = await resolveAffected(impact);
    } catch {
      // 模型配置不依赖知识库可用；保留“未知”事实，由用户决定是否继续。
    }
    if (affected) {
      const unique = new Map(affected.map(item => [item.id, item]));
      if (unique.size === 0) return true;
      detail = message('settings.modelConfig.embedding.editConfirm.message', {
        count: unique.size,
        names: [...unique.values()]
          .slice(0, 5)
          .map(item => item.name)
          .join('、'),
      });
    }
  }
  return (dependencies.confirm ?? confirm)({
    title: message('settings.modelConfig.embedding.editConfirm.title'),
    message: detail,
    confirmText: message('settings.modelConfig.embedding.editConfirm.confirm'),
    cancelText: message('settings.modelConfig.embedding.changeConfirm.cancel'),
  });
}

export function confirmEmbeddingRouteEdit(
  modelIds: readonly string[],
  message: SettingsMessageResolver,
  dependencies: ImpactDependencies = {}
): Promise<boolean> {
  return confirmImpact(
    async port =>
      (await Promise.all(modelIds.map(id => port.findKnowledgeBasesUsingModel(id)))).flat(),
    message,
    dependencies
  );
}

export function confirmEmbeddingModelSelection(
  nextModelId: string,
  message: SettingsMessageResolver,
  dependencies: ImpactDependencies = {}
): Promise<boolean> {
  return confirmImpact(port => port.findImpactedKnowledgeBases(nextModelId), message, dependencies);
}
