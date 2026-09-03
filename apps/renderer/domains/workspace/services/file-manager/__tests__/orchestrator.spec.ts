import { describe, it, expect, vi } from 'vitest';
import { FileManagerOrchestrator } from '../orchestrator';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('FileManagerOrchestrator', () => {
    it('应当按入队顺序串行执行任务（不并发）', async () => {
        const o = new FileManagerOrchestrator();
        const steps: string[] = [];

        const gate = createDeferred<void>();

        const a = o.enqueue('A', async () => {
            steps.push('A:start');
            await gate.promise;
            steps.push('A:end');
            return 'A';
        });

        const b = o.enqueue('B', async () => {
            steps.push('B:start');
            steps.push('B:end');
            return 'B';
        });

        // A 未放行时，B 不应开始
        await Promise.resolve();
        expect(steps).toEqual(['A:start']);

        gate.resolve();
        await expect(a).resolves.toBe('A');
        await expect(b).resolves.toBe('B');

        expect(steps).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
    });

    it('前一个任务失败不应阻断后续任务（队列不中断）', async () => {
        const o = new FileManagerOrchestrator();
        const steps: string[] = [];
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const failing = o.enqueue('FAIL', async () => {
            steps.push('fail:start');
            throw new Error('boom');
        });

        const next = o.enqueue('NEXT', async () => {
            steps.push('next:start');
            return 42;
        });

        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toBe(42);

        expect(steps).toEqual(['fail:start', 'next:start']);
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });
});

