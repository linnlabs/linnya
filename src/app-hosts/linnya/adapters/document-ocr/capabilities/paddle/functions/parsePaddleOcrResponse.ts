import type { OcrDocumentPage } from 'src/domains/document-ocr';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function parsePaddleLayoutPages(
  response: unknown,
  firstPageNumber: number
): OcrDocumentPage[] {
  if (!isRecord(response)) return [];
  const result = response.result;
  if (!isRecord(result)) return [];
  const results = result.layoutParsingResults;
  if (!Array.isArray(results)) return [];

  return results.map((item, index) => {
    const pageNumber = firstPageNumber + index;
    if (!isRecord(item)) {
      return { pageNumber, markdown: '' };
    }

    const markdown = item.markdown;
    const markdownText =
      isRecord(markdown) && typeof markdown.text === 'string' ? markdown.text.trim() : '';
    const markdownImages = isRecord(markdown) ? readStringRecord(markdown.images) : undefined;
    const outputImages = readStringRecord(item.outputImages);

    return {
      pageNumber,
      markdown: markdownText,
      ...(markdownImages ? { images: markdownImages } : {}),
      ...(outputImages ? { outputImages } : {}),
    };
  });
}
