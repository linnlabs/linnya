import { extractCanonicalCitationRefs, normalizeCitationWebUrl } from '../../../../citation';
import type { PendingRevisionMetadata } from '../../pending-revisions';
import { planMarkdownBlocks } from '../../normalization';
import {
  admitMarkdownCitationLinkHydration,
  admitMarkdownCitationHydration,
  type ResolveMarkdownCitationSources,
  type ResolveMarkdownCitationSourcesByUrl,
} from '../functions/admitMarkdownCitationHydration';

export async function buildMarkdownPendingCitationMetadata(
  targetText: string,
  resolveSources: ResolveMarkdownCitationSources,
  options: {
    readonly collectLinkHrefs?: (markdown: string) => Promise<readonly string[]>;
    readonly resolveSourcesByUrl?: ResolveMarkdownCitationSourcesByUrl;
  } = {},
): Promise<ReadonlyMap<string, PendingRevisionMetadata>> {
  const planned = await planMarkdownBlocks(targetText);
  const blocks = planned.bodyBlocks;
  const hasCanonicalCitation = targetText.includes('[@') || targetText.includes('\\[@');
  const hydration = hasCanonicalCitation
    ? await admitMarkdownCitationHydration(targetText, resolveSources)
    : {};
  const linksByBlock = options.collectLinkHrefs
    ? await Promise.all(blocks.map(block => options.collectLinkHrefs?.(block) ?? Promise.resolve([])))
    : blocks.map(() => [] as readonly string[]);
  const allLinks = Array.from(new Set(linksByBlock.flat().map(normalizeCitationWebUrl)));
  const linkHydration = options.resolveSourcesByUrl && allLinks.length > 0
    ? await admitMarkdownCitationLinkHydration(allLinks, options.resolveSourcesByUrl)
    : {};

  if (blocks.length === 0) {
    return new Map();
  }

  const metaByMarkdown = new Map<string, PendingRevisionMetadata>();

  for (const [blockIndex, markdown] of blocks.entries()) {
    const refs = extractCanonicalCitationRefs(markdown);
    const blockHydration = Object.fromEntries(refs.map(ref => {
      const source = hydration[ref];
      if (!source) throw new Error(`Pending citation hydration 缺少已接纳来源 [@${ref}]。`);
      return [ref, source];
    }));
    const blockLinks = Object.fromEntries(
      Array.from(new Set(linksByBlock[blockIndex] ?? []))
        .map(normalizeCitationWebUrl)
        .flatMap(url => linkHydration[url] ? [[url, linkHydration[url]]] : [])
    );
    if (Object.keys(blockHydration).length === 0 && Object.keys(blockLinks).length === 0) continue;
    metaByMarkdown.set(markdown, {
      ...(Object.keys(blockHydration).length > 0 ? { citation_hydration: blockHydration } : {}),
      ...(Object.keys(blockLinks).length > 0 ? { citation_link_hydration: blockLinks } : {}),
    });
  }

  return metaByMarkdown;
}
