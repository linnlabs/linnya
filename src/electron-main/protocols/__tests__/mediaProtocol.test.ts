import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MediaProtocolModule = typeof import('../mediaProtocol');
type FileReadGrantsModule = typeof import('../../ipc/handlers/system/file-read-grants');
type PathManagerModule = typeof import('../../../shared/utils/pathManager');
const netFetchMock = vi.hoisted(() => vi.fn());
const protocolHandleMock = vi.hoisted(() => vi.fn());
const protocolRegisterSchemesAsPrivilegedMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  net: {
    fetch: netFetchMock,
  },
  protocol: {
    handle: protocolHandleMock,
    registerSchemesAsPrivileged: protocolRegisterSchemesAsPrivilegedMock,
  },
}));

const tempDirs: string[] = [];
let previousWorkspaceDir: string | undefined;
let mediaProtocol: MediaProtocolModule;
let fileReadGrants: FileReadGrantsModule;
let pathManager: PathManagerModule;

function encodeMediaPath(filePath: string): string {
  return Buffer.from(filePath, 'utf8').toString('base64url');
}

function buildMediaUrl(operation: string, filePath: string): string {
  return `media://load/${operation}/${encodeMediaPath(filePath)}`;
}

function mediaRequest(url: string, headers?: HeadersInit): Pick<Request, 'url' | 'headers'> {
  return {
    url,
    headers: new Headers(headers),
  };
}

async function createTempDir(prefix = 'linnya-media-protocol-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(filePath: string, content: Buffer | string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
}

async function readResponseBody(response: Response): Promise<string> {
  return response.text();
}

beforeEach(async () => {
  vi.resetModules();
  netFetchMock.mockReset();
  protocolHandleMock.mockReset();
  protocolRegisterSchemesAsPrivilegedMock.mockReset();

  previousWorkspaceDir = process.env.LINNYA_WORKSPACE_DIR;
  process.env.LINNYA_WORKSPACE_DIR = await createTempDir();

  pathManager = await import('../../../shared/utils/pathManager');
  pathManager.resetWorkspaceRootToDefault();
  fileReadGrants = await import('../../ipc/handlers/system/file-read-grants');
  fileReadGrants.clearSessionReadGrantsForTests();
  mediaProtocol = await import('../mediaProtocol');
  netFetchMock.mockImplementation(async (fileUrl: string, init?: RequestInit) => {
    const buffer = await fs.readFile(fileURLToPath(fileUrl));
    const range = init?.headers instanceof Headers ? init.headers.get('range') : null;
    if (range === 'bytes=0-3') {
      return new Response(buffer.subarray(0, 4), {
        status: 206,
        headers: {
          'content-range': `bytes 0-3/${buffer.length}`,
        },
      });
    }
    const contentType = fileUrl.endsWith('.webm') ? 'audio/webm' : 'image/png';
    return new Response(buffer, {
      status: 200,
      headers: { 'content-type': contentType },
    });
  });
});

afterEach(async () => {
  if (previousWorkspaceDir === undefined) {
    delete process.env.LINNYA_WORKSPACE_DIR;
  } else {
    process.env.LINNYA_WORKSPACE_DIR = previousWorkspaceDir;
  }
  pathManager?.resetWorkspaceRootToDefault();
  fileReadGrants?.clearSessionReadGrantsForTests();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('media protocol', () => {
  function conversationGeneratedImagesPath(...segments: string[]): string {
    return path.join(
      pathManager.getConversationWorkDirectoriesPath(),
      'conversation-test',
      'generated-images',
      ...segments,
    );
  }

  it('registers media as a non-CORS streaming privileged scheme', () => {
    mediaProtocol.registerMediaProtocolSchemeAsPrivileged();

    expect(protocolRegisterSchemesAsPrivilegedMock).toHaveBeenCalledWith([{
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
        bypassCSP: false,
      },
    }]);
  });

  it('serves an allowed image as a streamed file response', async () => {
    const imagePath = await writeFile(
      conversationGeneratedImagesPath('image.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]),
    );

    const response = await mediaProtocol.handleMediaProtocolRequest(mediaRequest(buildMediaUrl('image', imagePath)));
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(netFetchMock).toHaveBeenCalledWith(expect.stringMatching(/^file:/), {});
  });

  it('passes Range headers through for audio resource seeking', async () => {
    const audioPath = await writeFile(
      path.join(process.env.LINNYA_WORKSPACE_DIR as string, 'AudioRecordings', 'recording.webm'),
      Buffer.from([1, 2, 3, 4, 5, 6]),
    );

    const response = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('audio', audioPath), { range: 'bytes=0-3' }),
    );
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/6');
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    const fetchOptions = netFetchMock.mock.calls[0]?.[1];
    expect(fetchOptions?.headers).toBeInstanceOf(Headers);
    expect(fetchOptions.headers.get('range')).toBe('bytes=0-3');
  });

  it('serves conversation generated-image absolute paths and rejects legacy relative paths', async () => {
    const generatedImagePath = await writeFile(
      conversationGeneratedImagesPath('generated.webp'),
      Buffer.from([1, 2, 3]),
    );

    const absoluteResponse = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('generated-image', generatedImagePath)),
    );
    const relativeResponse = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('generated-image', 'generated.webp')),
    );

    expect(absoluteResponse.status).toBe(200);
    expect(relativeResponse.status).toBe(403);
  });

  it('does not authorize historical global generated-image paths', async () => {
    const legacyImagePath = await writeFile(
      path.join(process.env.LINNYA_WORKSPACE_DIR as string, 'GeneratedImages', 'legacy.png'),
      Buffer.from([1, 2, 3]),
    );

    const response = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('generated-image', legacyImagePath)),
    );

    expect(response.status).toBe(403);
  });

  it('serves doc-image locators from DocumentMedia using relative paths', async () => {
    await writeFile(
      path.join(process.env.LINNYA_WORKSPACE_DIR as string, 'DocumentMedia', 'doc-1', 'image.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const response = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('doc-image', 'doc-1/image.png')),
    );
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('denies doc-image absolute paths and traversal into other controlled roots', async () => {
    const generatedPath = await writeFile(
      conversationGeneratedImagesPath('generated.png'),
      Buffer.from([1]),
    );

    const absoluteResponse = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('doc-image', generatedPath)),
    );
    const traversalResponse = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('doc-image', '../ConversationWorkDirectories/generated.png')),
    );

    expect(absoluteResponse.status).toBe(403);
    expect(traversalResponse.status).toBe(403);
  });

  it('denies files outside controlled roots unless they were session-granted', async () => {
    const outsidePath = await writeFile(path.join(await createTempDir(), 'selected.png'), Buffer.from([1]));

    const deniedResponse = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('image', outsidePath)),
    );
    expect(deniedResponse.status).toBe(403);

    await fileReadGrants.issueReadGrant(outsidePath);
    const grantedResponse = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('image', outsidePath)),
    );
    expect(grantedResponse.status).toBe(200);
  });

  it('returns 404 for missing files without echoing the path', async () => {
    const missingPath = conversationGeneratedImagesPath('missing.png');

    const response = await mediaProtocol.handleMediaProtocolRequest(mediaRequest(buildMediaUrl('image', missingPath)));
    const body = await readResponseBody(response);

    expect(response.status).toBe(404);
    expect(body).not.toContain(missingPath);
  });

  it('denies operation/extension mismatches without echoing the path', async () => {
    const textPath = await writeFile(
      conversationGeneratedImagesPath('notes.txt'),
      'not image',
    );

    const response = await mediaProtocol.handleMediaProtocolRequest(mediaRequest(buildMediaUrl('image', textPath)));
    const body = await readResponseBody(response);

    expect(response.status).toBe(403);
    expect(body).not.toContain(textPath);
  });

  it('rejects malformed base64url path segments as bad requests', async () => {
    const response = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest('media://load/image/not%20base64'),
    );
    const body = await readResponseBody(response);

    expect(response.status).toBe(400);
    expect(body).toBe('bad request');
  });

  it('resolves traversal attempts before applying root authorization', async () => {
    const outsidePath = await writeFile(path.join(await createTempDir(), 'escape.png'), Buffer.from([1]));
    const controlledRoot = pathManager.getConversationWorkDirectoriesPath();
    const traversalPath = `${controlledRoot}${path.sep}${path.relative(controlledRoot, outsidePath)}`;

    const response = await mediaProtocol.handleMediaProtocolRequest(
      mediaRequest(buildMediaUrl('image', traversalPath)),
    );

    expect(response.status).toBe(403);
  });

  it('keeps all failure response bodies free of internal path details', async () => {
    const outsidePath = await writeFile(path.join(await createTempDir(), 'secret.png'), Buffer.from([1]));
    const responses = await Promise.all([
      mediaProtocol.handleMediaProtocolRequest(mediaRequest(buildMediaUrl('video', outsidePath))),
      mediaProtocol.handleMediaProtocolRequest(mediaRequest(buildMediaUrl('image', outsidePath))),
      mediaProtocol.handleMediaProtocolRequest(mediaRequest('media://load/image/%%%')),
    ]);

    for (const response of responses) {
      expect(await readResponseBody(response)).not.toContain(outsidePath);
    }
  });
});
