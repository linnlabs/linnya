/**
 * flow.ts
 *
 * file-manager 的可测试编排函数集合（纯编排，不直接依赖 store / vue）。
 */

/**
 * 保存(view-switch) → deactivate → action 的严格顺序编排。
 *
 * 中文说明（核心不变量）：
 * - view-switch 必须先保存，再关闭会话（释放引擎/订阅），最后才执行真正的跳转动作；
 * - 若保存失败且要求强一致，则必须中止后续步骤，避免“保存失败但仍切走导致内容丢失/NO_ENGINE”。
 */
export async function runSaveDeactivateThen(params: {
    save: () => Promise<boolean>;
    deactivate: () => Promise<void>;
    action: () => void | Promise<void>;
    /** 默认 true：保存失败就抛错并中止 */
    throwOnSaveFailure?: boolean;
}): Promise<void> {
    const throwOnSaveFailure = params.throwOnSaveFailure !== false;
    const ok = await params.save();
    if (!ok && throwOnSaveFailure) {
        throw new Error('[file-manager] runSaveDeactivateThen: save failed');
    }
    await params.deactivate();
    await params.action();
}

