import { expect, it } from 'vitest';
import { PresentationRevisionScope } from './PresentationRevisionScope';

it('nested builds share the document lock and assets while independent writers remain queued', async () => {
  const scope = new PresentationRevisionScope();
  const order: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  const first = scope.run('deck', async () => {
    scope.record('deck', { assetId: 'image', kind: 'image' });
    await scope.run('deck', async () => {
      expect(scope.read('deck')).toEqual([{ assetId: 'image', kind: 'image' }]);
      order.push('nested');
      await pending;
    });
    order.push('first');
    throw new Error('failed build');
  });
  const failure = expect(first).rejects.toThrow('failed build');
  const second = scope.run('deck', async () => {
    order.push('second');
    expect(scope.read('deck')).toEqual([]);
  });
  await scope.run('other', async () => {
    order.push('other');
  });
  expect(order).toEqual(['nested', 'other']);
  release();
  await failure;
  await second;
  expect(order).toEqual(['nested', 'other', 'first', 'second']);
});

it('deferred maintenance inherited from a completed scope must reacquire the lock', async () => {
  const scope = new PresentationRevisionScope();
  let startMaintenance!: () => void;
  let releaseWriter!: () => void;
  const maintenanceTrigger = new Promise<void>(resolve => {
    startMaintenance = resolve;
  });
  const writerGate = new Promise<void>(resolve => {
    releaseWriter = resolve;
  });
  let maintenance: Promise<void> | undefined;
  const order: string[] = [];
  await scope.run('deck', async () => {
    maintenance = maintenanceTrigger.then(() =>
      scope.run('deck', async () => {
        order.push('maintenance');
      })
    );
  });
  const writer = scope.run('deck', async () => {
    order.push('writer');
    await writerGate;
  });
  startMaintenance();
  await Promise.resolve();
  await Promise.resolve();
  expect(order).toEqual(['writer']);
  releaseWriter();
  await writer;
  await maintenance;
  expect(order).toEqual(['writer', 'maintenance']);
});
