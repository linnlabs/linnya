const FIXTURE_API_PORT = 43119;
const FIXTURE_API_TOKEN = 'conversation-image-fixture-token';

let stagedDraftSequence = 0;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFixtureImageBlob(assetId: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 300;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('图片 fixture 无法创建 canvas 上下文');

  const isSecondImage = assetId === 'fixture-asset-secondary';
  context.fillStyle = isSecondImage ? '#d7e9f8' : '#e2f0df';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = isSecondImage ? '#236b8e' : '#347b45';
  context.fillRect(32, 32, 148, 236);
  context.fillStyle = isSecondImage ? '#efb34c' : '#e8a949';
  context.beginPath();
  context.arc(338, 116, 70, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#202a25';
  context.font = '600 28px sans-serif';
  context.fillText(isSecondImage ? 'History B' : 'History A', 218, 238);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('图片 fixture 无法编码 PNG'));
    }, 'image/png');
  });
}

async function readStagedFile(init?: RequestInit): Promise<File | null> {
  const body = init?.body;
  if (!(body instanceof FormData)) return null;
  const entry = body.get('file');
  return entry instanceof File ? entry : null;
}

async function fixtureFetch(
  fallbackFetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const rawUrl = input instanceof Request ? input.url : input.toString();
  const url = new URL(rawUrl, window.location.href);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

  if (url.pathname === '/api/v1/conversation/attachments/images' && method === 'POST') {
    const file = await readStagedFile(init);
    if (!file) return jsonResponse({ code: 'conversation.image.invalid_image' }, 400);
    if (!file.type.startsWith('image/')) {
      return jsonResponse({ code: 'conversation.image.unsupported_format' }, 415);
    }

    stagedDraftSequence += 1;
    return jsonResponse({
      draft: {
        draftId: `fixture-draft-${stagedDraftSequence}`,
        kind: 'image',
        fileName: file.name,
      },
      mediaType: 'image/png',
      byteLength: Math.max(1, file.size),
      width: 480,
      height: 300,
      sha256: String(stagedDraftSequence % 10).repeat(64),
    });
  }

  if (
    url.pathname.startsWith('/api/v1/conversation/attachments/images/')
    && method === 'DELETE'
  ) {
    return new Response(null, { status: 204 });
  }

  const previewMatch = url.pathname.match(/^\/api\/v1\/conversation\/assets\/images\/([^/]+)\/content$/);
  if (previewMatch && method === 'GET') {
    const assetId = decodeURIComponent(previewMatch[1]);
    if (assetId === 'fixture-asset-missing') {
      return jsonResponse({ code: 'conversation.image.asset_not_found' }, 404);
    }
    if (assetId === 'fixture-asset-corrupt') {
      return jsonResponse({ code: 'conversation.image.asset_integrity_failed' }, 409);
    }
    const blob = await createFixtureImageBlob(assetId);
    return new Response(blob, { headers: { 'Content-Type': 'image/png' } });
  }

  return fallbackFetch(input, init);
}

/**
 * 图片验收页仍走生产 adapter；这里只在 app host 边界模拟 Electron 会话和 HTTP 服务。
 * fixture 独占页面生命周期，pagehide 时恢复全局能力，避免热导航污染其它开发页面。
 */
export function installConversationImageAttachmentFixtureHost(): void {
  const originalElectronApiDescriptor = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const originalFetch = globalThis.fetch.bind(globalThis);

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      onApiPortSet: () => () => undefined,
      invoke: async (channel: string) => channel === 'api:get-port'
        ? { port: FIXTURE_API_PORT, token: FIXTURE_API_TOKEN }
        : { success: false, error: `Fixture 不支持通道：${channel}` },
    },
  });
  globalThis.fetch = (input, init) => fixtureFetch(originalFetch, input, init);

  window.addEventListener('pagehide', () => {
    globalThis.fetch = originalFetch;
    if (originalElectronApiDescriptor) {
      Object.defineProperty(window, 'electronAPI', originalElectronApiDescriptor);
    } else {
      Reflect.deleteProperty(window, 'electronAPI');
    }
  }, { once: true });
}
