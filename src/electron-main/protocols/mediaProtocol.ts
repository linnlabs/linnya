import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  assertReadablePath,
  resolveDocImageInputPath,
  type ReadPathOperation,
} from '../ipc/handlers/system/media-path-rules';
import {
  getMediaProtocolPrivilegedScheme,
  MEDIA_PROTOCOL_SCHEME,
} from './definitions/privilegedSchemes';

const mediaScheme = MEDIA_PROTOCOL_SCHEME;
const mediaLoadHost = 'load';
const supportedOperations = new Set<ReadPathOperation>(['image', 'generated-image', 'doc-image', 'audio']);
let isMediaProtocolHandlerRegistered = false;

function textResponse(message: string, status: number): Response {
  return new Response(message, { status });
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
    return Buffer.from(`${value}${padding}`, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function isSupportedOperation(value: string): value is ReadPathOperation {
  return supportedOperations.has(value as ReadPathOperation);
}

function buildFileFetchOptions(request: Pick<Request, 'headers'>): { headers?: Headers } {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) {
    return {};
  }

  const headers = new Headers();
  headers.set('range', rangeHeader);
  return { headers };
}

export function registerMediaProtocolSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([getMediaProtocolPrivilegedScheme()]);
}

export async function handleMediaProtocolRequest(request: Pick<Request, 'url' | 'headers'>): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return textResponse('bad request', 400);
  }

  if (url.protocol !== `${mediaScheme}:` || url.hostname !== mediaLoadHost) {
    return textResponse('not found', 404);
  }

  const pathSegments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (pathSegments.length !== 2) {
    return textResponse('not found', 404);
  }

  const [operation, encodedPath] = pathSegments;
  if (!isSupportedOperation(operation)) {
    return textResponse('forbidden', 403);
  }

  const decodedPath = decodeBase64Url(encodedPath);
  if (!decodedPath) {
    return textResponse('bad request', 400);
  }

  try {
    const inputPath = operation === 'doc-image'
        ? await resolveDocImageInputPath(decodedPath)
        : decodedPath;
    const readablePath = await assertReadablePath(inputPath, { operation });
    return await net.fetch(pathToFileURL(readablePath).toString(), buildFileFetchOptions(request));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return textResponse('not found', 404);
    }
    return textResponse('forbidden', 403);
  }
}

export function registerMediaProtocolHandler(): void {
  if (isMediaProtocolHandlerRegistered) {
    return;
  }
  isMediaProtocolHandlerRegistered = true;

  protocol.handle(mediaScheme, handleMediaProtocolRequest);
}
