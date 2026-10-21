import { createCitationSourceIdentity, normalizeCitationWebUrl, type WebCitationSource } from '../../../../citation';
import type { MarkdownFileWriteSnapshot } from '../definitions/markdownFileWriteSnapshot';

/** URL 接纳保留 preview 优先的整份快照；归一 URL 若有多个来源身份则拒绝猜选。 */
export function selectMarkdownDocumentLinkSources(
  snapshot: MarkdownFileWriteSnapshot,
  urls: readonly string[],
): ReadonlyMap<string, WebCitationSource> {
  const known = new Map<string, WebCitationSource>();
  const requested = new Set(urls.map(normalizeCitationWebUrl));
  for (const source of [...snapshot.sources, ...snapshot.reservedSources]) {
    if (source.sourceType !== 'web') continue;
    const key = normalizeCitationWebUrl(source.url);
    if (!requested.has(key)) continue;
    const previous = known.get(key);
    if (previous && createCitationSourceIdentity(previous) !== createCitationSourceIdentity(source)) {
      throw new Error(`Web citation URL ${key} 对应了不同的来源锚点。`);
    }
    if (!previous) known.set(key, source);
  }
  return known;
}
