import type {
  ConfiguredProvider,
  ConfiguredProviderModel,
} from '../../definitions/providerConfiguration';

export interface CatalogedProviderMember<TModel> {
  readonly association: ConfiguredProviderModel;
  readonly model: TModel;
}

/**
 * 找出能代表这个 Provider 凭据与连接的成员：按归属顺序第一个能在运行目录里找到模型的成员。
 *
 * 归属可能指向启动时停用（未通过准入）的用户模型：它保留归属、等待修复或删除，但不在运行目录里，
 * 不能拿来判断凭据或复用连接，否则排在前面的停用模型会让整个 Provider 显得没有凭据。
 * 同一 connection 的成员共用一条凭据边界，所以取第一个能找到的成员即可。
 * 本 domain 不访问 Model Catalog，查找函数由调用方传入。
 */
export function findFirstCatalogedProviderMember<TModel>(
  provider: ConfiguredProvider,
  findModel: (modelConfigId: string) => TModel | undefined
): CatalogedProviderMember<TModel> | undefined {
  for (const association of provider.models) {
    const model = findModel(association.model_config_id);
    if (model !== undefined) return { association, model };
  }
  return undefined;
}
