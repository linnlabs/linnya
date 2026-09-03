import type {
  SvgGraphicAuthoringSource,
  SvgGraphicOwnedAssetRef,
  SvgGraphicResolvedAsset,
  SvgGraphicViewBox,
} from '@plugin/slides/shared/svgGraphic';
import type { PluginConversationFilePathResolverPort } from '@linnya/plugin-host-contract/backend/workspaceRuntime';

export interface PresentationSvgGraphicBinding {
  readonly presentationId: string;
  readonly sourceIdentity: string;
  readonly assetId: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly viewBox: SvgGraphicViewBox;
  readonly createdAt: number;
}

export interface PresentationSvgGraphicBindingReaderPort {
  find(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
  }): PresentationSvgGraphicBinding | null;
}

export interface PresentationSvgGraphicBindingRepositoryPort
  extends PresentationSvgGraphicBindingReaderPort {
  bind(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
    readonly assetId: string;
    readonly contentHash: string;
    readonly byteLength: number;
    readonly viewBox: SvgGraphicViewBox;
    readonly createdAt?: number;
  }): PresentationSvgGraphicBinding;
}

export interface SvgGraphicOwnershipContext {
  readonly documentId: string;
  readonly conversationId?: string;
}

export interface SvgGraphicAssetReadContext {
  readonly documentId?: string;
  readonly projectId?: string;
  readonly conversationId?: string;
}

export interface PresentationSvgGraphicOwnerPort {
  ownSource(
    source: SvgGraphicAuthoringSource,
    context: SvgGraphicOwnershipContext
  ): Promise<SvgGraphicOwnedAssetRef>;
}

export interface PresentationSvgGraphicAssetReaderPort {
  resolveSvgGraphicAsset(
    ref: SvgGraphicOwnedAssetRef,
    context?: SvgGraphicAssetReadContext
  ): Promise<SvgGraphicResolvedAsset>;
}

export interface ConversationAwarePresentationSvgGraphicOwnerPort
  extends PresentationSvgGraphicOwnerPort, PresentationSvgGraphicAssetReaderPort {
  bindConversationFilePathResolver(resolver: PluginConversationFilePathResolverPort): void;
}
