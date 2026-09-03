interface LocalApiSession {
  readonly port: number;
  readonly token: string;
  readonly baseUrl: string;
}

const API_HTTP_HOST = '127.0.0.1';

let apiSession: LocalApiSession | null = null;
let apiSessionInFlight: Promise<LocalApiSession> | null = null;

function readApiSessionFromMainProcessResult(result: unknown): LocalApiSession {
  if (
    typeof result !== 'object'
    || result === null
    || typeof Reflect.get(result, 'port') !== 'number'
    || !Number.isFinite(Reflect.get(result, 'port'))
    || Reflect.get(result, 'port') <= 0
    || typeof Reflect.get(result, 'token') !== 'string'
    || Reflect.get(result, 'token').length === 0
  ) {
    throw new Error('api:get-port 返回非法响应');
  }

  const port = Reflect.get(result, 'port');
  const token = Reflect.get(result, 'token');
  if (typeof port !== 'number' || typeof token !== 'string') {
    throw new Error('api:get-port 返回非法响应');
  }
  return {
    port,
    token,
    baseUrl: `http://${API_HTTP_HOST}:${port}`,
  };
}

async function fetchApiSessionFromMainProcess(forceRefresh = false): Promise<LocalApiSession> {
  if (!forceRefresh && apiSession) return apiSession;
  if (!forceRefresh && apiSessionInFlight) return apiSessionInFlight;

  apiSessionInFlight = (async () => {
    const result = await window.electronAPI.invoke('api:get-port');
    const nextSession = readApiSessionFromMainProcessResult(result);
    apiSession = nextSession;
    return nextSession;
  })().finally(() => {
    apiSessionInFlight = null;
  });

  return apiSessionInFlight;
}

function isSameApiSession(left: LocalApiSession, right: LocalApiSession): boolean {
  return left.port === right.port && left.token === right.token;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function buildLocalApiUrl(input: RequestInfo | URL, session: LocalApiSession): string | URL {
  const rawUrl = input instanceof Request ? input.url : input;
  const url = new URL(rawUrl, session.baseUrl);
  if (url.hostname !== API_HTTP_HOST && url.hostname !== 'localhost') return rawUrl;

  url.protocol = 'http:';
  url.hostname = API_HTTP_HOST;
  url.port = String(session.port);
  return url.toString();
}

function buildApiFetchInput(input: RequestInfo | URL, session: LocalApiSession): RequestInfo | URL {
  const url = buildLocalApiUrl(input, session);
  return input instanceof Request ? new Request(url, input) : url;
}

async function fetchWithApiSession(
  input: RequestInfo | URL,
  init: RequestInit,
  session: LocalApiSession,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-API-Token', session.token);
  return fetch(buildApiFetchInput(input, session), { ...init, headers });
}

/** 获取 Electron 主进程托管的本地 HTTP API 地址。 */
export async function getApiBaseUrl(): Promise<string> {
  return (await fetchApiSessionFromMainProcess()).baseUrl;
}

/**
 * 本地 API 的唯一鉴权 chokepoint。
 *
 * 401 或主进程热重启时只在会话快照确实变化后重试一次；业务 domain 不接触 token。
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const session = await fetchApiSessionFromMainProcess();
  try {
    const response = await fetchWithApiSession(input, init, session);
    if (response.status !== 401) return response;

    const refreshedSession = await fetchApiSessionFromMainProcess(true);
    return isSameApiSession(session, refreshedSession)
      ? response
      : fetchWithApiSession(input, init, refreshedSession);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const refreshedSession = await fetchApiSessionFromMainProcess(true);
    if (!(error instanceof TypeError) || isSameApiSession(session, refreshedSession)) {
      throw error;
    }
    return fetchWithApiSession(input, init, refreshedSession);
  }
}

export async function getApiToken(): Promise<string> {
  return (await fetchApiSessionFromMainProcess()).token;
}

export async function refreshApiSession(): Promise<{ baseUrl: string; token: string }> {
  const session = await fetchApiSessionFromMainProcess(true);
  return { baseUrl: session.baseUrl, token: session.token };
}
