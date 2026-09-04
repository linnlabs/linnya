import { extractCanonicalCitationRefs } from '../../../../citation';
import type { PendingRevisionMetadata } from '../../pending-revisions';
import { planMarkdownBlocks } from '../../normalization';
import {
  admitMarkdownCitationHydration,
  type ResolveMarkdownCitationSources,
} from '../functions/admitMarkdownCitationHydration';

export async function buildMarkdownPendingCitationMetadata(
  targetText: string,
  resolveSources: ResolveMarkdownCitationSources,
): Promise<ReadonlyMap<string, PendingRevisionMetadata>> {
  if (!targetText.includes('[@') && !targetText.includes('\\[@')) {
    return new Map();
  }

  const planned = await planMarkdownBlocks(targetText);
  const blocksWithCitation = planned.bodyBlocks.filter((block) =>
    block.includes('[@') || block.includes('\\[@')
  );
  if (blocksWithCitation.length === 0) {
    return new Map();
  }

  const hydration = await admitMarkdownCitationHydration(targetText, resolveSources);
  const metaByMarkdown = new Map<string, PendingRevisionMetadata>();

  for (const markdown of blocksWithCitation) {
    const refs = extractCanonicalCitationRefs(markdown);
    if (refs.length === 0) continue;
    const blockHydration = Object.fromEntries(refs.map(ref => {
      const source = hydration[ref];
      if (!source) {
        throw new Error(`Pending citation hydration 缺少已接纳来源 [@${ref}]。`);
      }
      return [ref, source];
    }));
    metaByMarkdown.set(markdown, {
      citation_hydration: blockHydration,
    });
  }

  return metaByMarkdown;
}
