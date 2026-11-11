import type { ImageSearchCandidate, ImageSearchSourceStatus } from '@app/schemas';
import { createBoundaryToken, wrapUntrustedWebContent } from '../../shared/observation/untrustedWebContent';

const SOURCE_NAMES: Readonly<Record<ImageSearchSourceStatus['source'], string>> = {
  wikimedia_commons: 'Wikimedia Commons',
  openverse: 'Openverse',
};

function describeLicense(candidate: ImageSearchCandidate): string {
  const license = candidate.license;
  const terms = [
    license.commercial_use ? 'commercial use allowed' : license.code === 'other' ? 'terms not classified; check the page' : 'non-commercial only',
    ...(license.code !== 'other' && !license.modifications ? ['no modifications (do not crop or alter)'] : []),
    ...(license.code.includes('sa') ? ['share-alike'] : []),
    license.attribution_required ? 'attribution required' : 'no attribution required',
  ];
  return `${license.name} — ${terms.join('; ')}`;
}

function describeSize(candidate: ImageSearchCandidate): string {
  if (!candidate.width || !candidate.height) return 'size unknown';
  const original = `${candidate.width}×${candidate.height}`;
  if (candidate.download_width && candidate.download_width < candidate.width) {
    const height = Math.round((candidate.height * candidate.download_width) / candidate.width);
    return `${candidate.download_width}×${height} download (original ${original})`;
  }
  return original;
}

/**
 * 可信骨架（编号、尺寸、许可、地址）留在边界外；标题、作者、描述和署名文字来自外部元数据，放进不可信边界。
 * 两部分按编号对应。
 */
export function buildImageSearchObservation(params: {
  readonly query: string;
  readonly commercialOnly: boolean;
  readonly candidates: readonly ImageSearchCandidate[];
  readonly sources: readonly ImageSearchSourceStatus[];
}): string {
  const sourceLine = params.sources
    .map(status => `${SOURCE_NAMES[status.source]} ${status.status === 'ok' ? `${status.result_count} results` : `failed (${status.error_kind ?? 'error'})`}`)
    .join('; ');
  const header = [
    `Image search for ${JSON.stringify(params.query)}${params.commercialOnly ? ' (commercial-use licenses only)' : ''}. Sources: ${sourceLine}.`,
  ];
  if (params.candidates.length === 0) {
    return [
      ...header,
      'No images found. Try other names for the subject (another language, the holding museum, an English or Latin name), or look for the original on the website of whoever holds it with web_search and web_read.',
    ].join('\n');
  }
  const skeleton = params.candidates.flatMap(candidate => [
    `[${candidate.id}] ${describeSize(candidate)}; ${describeLicense(candidate)}; from ${candidate.provider}`,
    `  download: ${candidate.download_url}`,
    `  page: ${candidate.page_url}`,
  ]);
  const metadata = params.candidates.map(candidate => [
    `[${candidate.id}] ${candidate.title}`,
    ...(candidate.creator ? [`  creator: ${candidate.creator}`] : []),
    ...(candidate.description ? [`  description: ${candidate.description}`] : []),
    `  attribution: ${candidate.attribution}`,
  ].join('\n')).join('\n');
  const token = createBoundaryToken(params.candidates.map(candidate => `${candidate.download_url}\n${candidate.attribution}`).join('\n'));
  return [
    ...header,
    'Licenses come from each source\'s metadata and are not verified here; check the page before relying on them for commercial or public use.',
    'To use an image, download it with web_read({"url": <download URL>}): the file is decoded, checked and saved in this conversation, and the receipt carries this source and license record. Look at it with read_file when your model can see images.',
    '',
    ...skeleton,
    '',
    'Titles, creators, descriptions and attribution text from the sources:',
    ...wrapUntrustedWebContent({ token, body: metadata }),
  ].join('\n');
}
