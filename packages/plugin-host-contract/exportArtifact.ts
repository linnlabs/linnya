/** Host 授权给插件的一次性保存目标；token 不包含也不暴露本机路径。 */
export interface ExportArtifactTarget {
  readonly token: string;
  readonly fileName: string;
}

export interface ExportArtifactDescriptor {
  readonly pluginId: string;
  readonly suggestedFileName: string;
  readonly extension: string;
  readonly mediaType: string;
}

export interface ExportArtifactDialogLabels {
  readonly title: string;
  readonly buttonLabel: string;
  readonly filterName: string;
}

export interface ExportArtifactTargetRequest extends ExportArtifactDescriptor {
  readonly labels: ExportArtifactDialogLabels;
}

export type ExportArtifactTargetResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'authorized'; readonly target: ExportArtifactTarget };

export interface ExportArtifactCommitRequest {
  readonly pluginId: string;
  readonly targetToken: string;
  readonly extension: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ExportArtifactCommitResult {
  readonly fileName: string;
  readonly byteLength: number;
}
