import { ExportArtifactRequestInvalidError } from '../definitions/exportErrors';

export interface RasterPdfPageFile {
  readonly fileName: string;
}

function requirePositiveDimension(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ExportArtifactRequestInvalidError(field);
  }
  return value;
}

/** Chromium 只负责分页封装；每页视觉事实已经由业务 renderer 生成。 */
export function buildRasterPdfDocumentHtml(input: {
  readonly pageWidthInches: number;
  readonly pageHeightInches: number;
  readonly pages: readonly RasterPdfPageFile[];
}): string {
  const pageWidthInches = requirePositiveDimension(
    input.pageWidthInches,
    'pageWidthInches',
  );
  const pageHeightInches = requirePositiveDimension(
    input.pageHeightInches,
    'pageHeightInches',
  );
  if (input.pages.length === 0) {
    throw new ExportArtifactRequestInvalidError('pages');
  }
  for (const page of input.pages) {
    if (!/^page-\d{4}\.png$/u.test(page.fileName)) {
      throw new ExportArtifactRequestInvalidError('page.fileName');
    }
  }

  const pages = input.pages
    .map(page => `<section class="pdf-page"><img src="./${page.fileName}" alt="" /></section>`)
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'" />
  <style>
    @page { size: ${pageWidthInches}in ${pageHeightInches}in; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .pdf-page { width: ${pageWidthInches}in; height: ${pageHeightInches}in; break-after: page; overflow: hidden; }
    .pdf-page:last-child { break-after: auto; }
    .pdf-page img { display: block; width: 100%; height: 100%; object-fit: fill; }
  </style>
</head>
<body>${pages}</body>
</html>`;
}
