export type EvidenceBundleStorageIdentity =
  | { readonly kind: 'canonical_bundle'; readonly bundleId: string }
  | { readonly kind: 'noncanonical_json' }
  | { readonly kind: 'other_file' };

export type EvidenceBundleSnapshot = {
  readonly instanceId: string;
  readonly displayName: string;
  /**
   * 文件名与扩展名只由持久化 adapter 解释。
   * resolver/list 消费领域身份，不能再次理解磁盘命名规则。
   */
  readonly storageIdentity: EvidenceBundleStorageIdentity;
} & (
  | { readonly status: 'readable'; readonly content: unknown }
  | { readonly status: 'unreadable' }
);

export interface EvidenceBundleRepositoryPort {
  listBundleSnapshots(params: {
    readonly conversationId: string;
    readonly preferredInstanceId: string;
    readonly scope: 'instance' | 'conversation';
  }): Promise<readonly EvidenceBundleSnapshot[]>;
}
