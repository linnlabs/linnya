import type {
  TextFontFaceFingerprint,
  TextFontResolutionKind,
  TextFontScript,
} from '../../textFontIdentity';
import type { TextLayoutResult } from './types';

export interface TextLayoutFontProvenance {
  readonly requestedFamily?: string;
  readonly resolvedFamily?: string;
  readonly script?: TextFontScript;
  readonly resolution?: TextFontResolutionKind;
  readonly faceFingerprint?: TextFontFaceFingerprint;
  readonly requestedWeight?: 'normal' | 'bold';
  readonly resolvedWeight?: 'normal' | 'bold';
  readonly requestedStyle?: 'normal' | 'italic';
  readonly resolvedStyle?: 'normal' | 'italic';
}

export interface TextLayoutAttentionNodeProvenance {
  readonly nodeId: string;
  readonly advanceSource: TextLayoutResult['advanceSource'];
  readonly lineCount: number;
  readonly contentWidthInches: number;
  readonly maxLineWidthInches: number;
  readonly maxSliceRightInches: number;
  readonly maxLetterSpacingPt: number;
  readonly overflow: TextLayoutResult['overflow'];
  readonly fontIdentities: readonly TextLayoutFontProvenance[];
}

/**
 * 一页文本布局的安全、紧凑归因摘要。
 * 只列出存在字距、溢出、字体替换或字体未决事实的节点；普通节点通过聚合计数表达，避免 manifest 随正文膨胀。
 */
export interface SlideTextLayoutProvenance {
  readonly nodeCount: number;
  readonly advanceSourceCounts: Readonly<Record<TextLayoutResult['advanceSource'], number>>;
  readonly overflowNodeCount: number;
  readonly unresolvedFontRunCount: number;
  readonly fontFamilySubstitutionRunCount: number;
  readonly fontStyleMismatchRunCount: number;
  readonly fontIdentities: readonly TextLayoutFontProvenance[];
  readonly attentionNodes: readonly TextLayoutAttentionNodeProvenance[];
}
