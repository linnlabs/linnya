import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderOutboundAttemptSnapshotSchema } from '@app/schemas/provider-outbound-audit';
import { createInMemoryProviderOutboundAudit } from 'src/domains/audit/features/provider-outbound-audit';
import { createProviderOutboundDebugRouter } from './providerOutboundDebugRouter';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Provider outbound debug 测试未取得 TCP address。');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('provider outbound debug router', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        server =>
          new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  it('只返回 audit domain 的安全快照，空 store 返回 404', async () => {
    const audit = createInMemoryProviderOutboundAudit();
    const app = express();
    app.use('/api/v1/debug/provider-outbound', createProviderOutboundDebugRouter(audit));
    const server = createServer(app);
    servers.push(server);
    const baseUrl = await listen(server);

    expect((await fetch(`${baseUrl}/api/v1/debug/provider-outbound/latest-attempt`)).status).toBe(
      404
    );

    audit.record({
      schema_version: 2,
      attempt_id: 'attempt-1',
      operation: 'document_ocr',
      route: {
        model_id: 'ocr-model',
        endpoint_id: 'paddleocr',
        endpoint_model_id: 'PaddleOCR-VL',
        api_surface: 'paddle_layout_parsing',
        capability_id: 'host:paddle-ocr-layout-parsing',
      },
      input: { kind: 'document_ocr', input_kind: 'image' },
      status: 'started',
      started_at: '2026-08-14T01:00:00.000Z',
      usage: { provenance: 'pending' },
    });

    const response = await fetch(`${baseUrl}/api/v1/debug/provider-outbound/latest-attempt`);
    const snapshot = ProviderOutboundAttemptSnapshotSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(snapshot).toMatchObject({ attempt_id: 'attempt-1', operation: 'document_ocr' });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('base_url');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('headers');
  });
});
