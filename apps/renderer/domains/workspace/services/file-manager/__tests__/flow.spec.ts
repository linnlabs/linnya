import { describe, it, expect } from 'vitest';
import { runSaveDeactivateThen } from '../flow';

describe('runSaveDeactivateThen', () => {
    it('应严格按 save → deactivate → action 顺序执行', async () => {
        const steps: string[] = [];
        await runSaveDeactivateThen({
            save: async () => {
                steps.push('save');
                return true;
            },
            deactivate: async () => {
                steps.push('deactivate');
            },
            action: async () => {
                steps.push('action');
            },
        });
        expect(steps).toEqual(['save', 'deactivate', 'action']);
    });

    it('保存失败且 throwOnSaveFailure=true 时应中止后续步骤', async () => {
        const steps: string[] = [];
        await expect(
            runSaveDeactivateThen({
                save: async () => {
                    steps.push('save');
                    return false;
                },
                deactivate: async () => {
                    steps.push('deactivate');
                },
                action: async () => {
                    steps.push('action');
                },
                throwOnSaveFailure: true,
            })
        ).rejects.toThrow();

        expect(steps).toEqual(['save']);
    });

    it('保存失败且 throwOnSaveFailure=false 时仍应继续执行 deactivate 与 action', async () => {
        const steps: string[] = [];
        await runSaveDeactivateThen({
            save: async () => {
                steps.push('save');
                return false;
            },
            deactivate: async () => {
                steps.push('deactivate');
            },
            action: async () => {
                steps.push('action');
            },
            throwOnSaveFailure: false,
        });

        expect(steps).toEqual(['save', 'deactivate', 'action']);
    });
});

