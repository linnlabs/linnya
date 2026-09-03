import type { ConversationRenderScope } from '../../../definitions/conversationRenderScope';
import type { SubrunDetailNavigationPort } from '../../subrun-detail';

export function requireSubrunProgressContext(params: {
  readonly navigation?: SubrunDetailNavigationPort;
  readonly renderScope?: ConversationRenderScope;
}): {
  readonly navigation: SubrunDetailNavigationPort;
  readonly renderScope: ConversationRenderScope;
} {
  if (!params.navigation || !params.renderScope) {
    throw new Error('SubrunProgressCard 未装配 ConversationHost navigation/render scope');
  }
  return {
    navigation: params.navigation,
    renderScope: params.renderScope,
  };
}

export function requireCanonicalSubrunId(value: string | undefined): string {
  if (!value) throw new Error('[SUBRUN_DETAIL_SCOPE_INVALID] 父卡缺少正式 subrunId');
  return value;
}
