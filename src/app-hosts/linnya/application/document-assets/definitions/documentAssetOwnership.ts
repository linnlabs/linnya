/** App-level 文档资产归属；媒体 ingress 由 image/SVG 各自 owner 负责。 */
export interface DocumentAssetOwnershipPort {
  ensureOwnership(input: {
    readonly documentId: string;
    readonly assetId: string;
    readonly usageHint: string;
  }): void;
  hasOwnership(input: { readonly documentId: string; readonly assetId: string }): boolean;
}
