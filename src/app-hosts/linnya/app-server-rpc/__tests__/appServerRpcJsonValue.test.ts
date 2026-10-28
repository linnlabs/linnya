import { expect, it } from 'vitest';
import { parseAppServerRpcFrame } from '../functions/appServerRpcCodec';

const frame = (payload: unknown) => ({ schema_version: 1, kind: 'request', request_id: 'json-test',
  method: 'backend.echo', payload });

it('RPC 准入拒绝 JSON 会静默丢失或改变的值；拒绝循环但允许重复引用', () => {
  const sparse = new Array<unknown>(1);
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  for (const payload of [undefined, Infinity, { n: NaN }, { omitted: undefined }, sparse,
    new Date(), new Map(), new Uint8Array([1]), () => null, 1n, cycle]) {
    expect(() => parseAppServerRpcFrame(frame(payload))).toThrow();
  }
  const shared = { kind: 'number', value: 2 };
  expect(parseAppServerRpcFrame(frame({ first: shared, second: shared }))).toMatchObject({
    payload: { first: shared, second: shared },
  });
});
