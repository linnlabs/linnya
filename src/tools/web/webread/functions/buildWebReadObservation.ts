import {
  createBoundaryToken,
  wrapUntrustedWebContent,
} from '../../shared/observation/untrustedWebContent';

export interface BuildWebReadObservationParams {
  ref: string;
  title: string;
  url: string;
  siteName?: string;
  content: string;
  contentHash: string;
  capturedCharCount: number;
  captureTruncated: boolean;
}

export function buildWebReadObservation(params: BuildWebReadObservationParams): string {
  const boundaryToken = createBoundaryToken(params.contentHash);
  const untrustedBody = [
    `Title: ${params.title}`,
    ...(params.siteName ? [`Site: ${params.siteName}`] : []),
    'Content:',
    params.content,
  ].join('\n');
  const lines = [
    `Web page evidence [@${params.ref}] source_type=web`,
    `URL: ${params.url}`,
    `Captured characters: ${params.capturedCharCount}${params.captureTruncated ? ' (capture truncated)' : ''}`,
    '',
    ...wrapUntrustedWebContent({ token: boundaryToken, body: untrustedBody }),
  ];
  return lines.join('\n');
}
