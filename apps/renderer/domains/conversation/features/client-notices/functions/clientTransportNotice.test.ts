import { expect, it } from 'vitest';
import { createSSETransportErrorEvent } from '@linnlabs/linnkit/contracts';
import { clientTransportNotice } from './clientTransportNotice';

it('keeps safe HTTP status and classifies server preadmission errors without exposing raw bodies or fake identities', () => {
  expect(clientTransportNotice({ source: 'client', kind: 'http', error: new Error('secret'), details: { status: 401, body: 'secret' } })).toEqual({ error_kind: 'http', http_status: 401 });
  expect(clientTransportNotice({ source: 'client', kind: 'network', error: new Error('secret') })).toEqual({ error_kind: 'connection' });
  expect(clientTransportNotice({ source: 'server', event: createSSETransportErrorEvent('id', 'conv', 'transport-only', 'sensitive provider failure', { execution_id: 'execution' }) })).toEqual({ error_kind: 'http' });
});
