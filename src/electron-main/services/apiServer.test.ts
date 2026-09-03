import { describe, expect, it } from 'vitest';

import {
  API_SERVER_BIND_HOST,
  isAllowedApiCorsOrigin,
  isConversationControlApiPath,
} from './apiServerSecurityRules';

describe('api server security boundary', () => {
  it('binds the local HTTP server to loopback only', () => {
    expect(API_SERVER_BIND_HOST).toBe('127.0.0.1');
  });

  it('allows renderer origins used by the desktop app', () => {
    expect(isAllowedApiCorsOrigin(undefined)).toBe(true);
    expect(isAllowedApiCorsOrigin('null')).toBe(true);
    expect(isAllowedApiCorsOrigin('file://')).toBe(true);
    expect(isAllowedApiCorsOrigin('app://linnya')).toBe(true);
    expect(isAllowedApiCorsOrigin('vscode-webview://workspace')).toBe(true);
  });

  it('allows Vite development origins', () => {
    expect(isAllowedApiCorsOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedApiCorsOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedApiCorsOrigin('http://localhost:5174')).toBe(true);
    expect(isAllowedApiCorsOrigin('http://127.0.0.1:5174')).toBe(true);
  });

  it('rejects arbitrary website origins instead of reflecting them', () => {
    expect(isAllowedApiCorsOrigin('http://evil.test')).toBe(false);
    expect(isAllowedApiCorsOrigin('https://example.com')).toBe(false);
    expect(isAllowedApiCorsOrigin('http://localhost:5175')).toBe(false);
    expect(isAllowedApiCorsOrigin('not a url')).toBe(false);
  });

  it('只把 conversation-control 自己的命名空间交给 CLI 鉴权', () => {
    expect(isConversationControlApiPath('/api/v1/conversation-control')).toBe(true);
    expect(isConversationControlApiPath('/api/v1/conversation-control/commands')).toBe(true);
    expect(isConversationControlApiPath('/api/v1/conversation')).toBe(false);
    expect(isConversationControlApiPath('/api/v1/conversation-control-evil')).toBe(false);
  });
});
