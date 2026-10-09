import type { WorkspaceFileLocator } from '@app/schemas';
import type { ToolLocalizedTextDescriptor } from '../../../ui/tools/types';

/** 交付卡只提供正式文件导航，不复制研究正文、版本哈希或质量判断。 */
export type ResearchCompletionPresentationData = {
  readonly kind: 'lifecycle';
} | {
  readonly kind: 'delivered';
  readonly articlePath: WorkspaceFileLocator;
  readonly reviewLinks: readonly {
    readonly path: WorkspaceFileLocator;
    readonly label: ToolLocalizedTextDescriptor;
  }[];
};
