import type { WebDocumentWarning } from '@app/schemas';
import {
  createBoundaryToken,
  wrapUntrustedWebContent,
} from '../../shared/observation/untrustedWebContent';
import type { WebPageResource } from '../../definitions/webDocument';

export interface BuildWebReadObservationParams {
  ref: string;
  title: string;
  url: string;
  siteName?: string;
  content: string;
  contentHash: string;
  capturedCharCount: number;
  captureTruncated: boolean;
  warnings?: readonly WebDocumentWarning[];
  resources?: readonly WebPageResource[];
}

export function buildWebReadObservation(params: BuildWebReadObservationParams): string {
  const boundaryToken = createBoundaryToken(params.contentHash);
  const untrustedBody = [
    `Title: ${params.title}`,
    ...(params.siteName ? [`Site: ${params.siteName}`] : []),
    ...(params.resources && params.resources.length > 0
      ? [
          'Related page resources:',
          ...params.resources.map(resource =>
            `- ${resource.kind}: ${resource.label ? `${resource.label} ` : ''}${resource.url}`),
        ]
      : []),
    'Content:',
    params.content,
  ].join('\n');
  const lines = [
    `Web page evidence [@${params.ref}] source_type=web`,
    `URL: ${params.url}`,
    `Captured characters: ${params.capturedCharCount}${params.captureTruncated ? ' (capture truncated)' : ''}`,
    ...(params.warnings && params.warnings.length > 0
      ? [
          `Extraction flags: ${params.warnings.join(', ')}. These are extraction heuristics, not a source reliability or completeness verdict. Check the captured passage and table context before citing a key claim.`,
        ]
      : []),
    '',
    ...wrapUntrustedWebContent({ token: boundaryToken, body: untrustedBody }),
  ];
  return lines.join('\n');
}
