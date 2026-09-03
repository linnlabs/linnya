# Renderer App 生命周期

这里承接跨页面的 renderer 根生命周期，不把保存规则塞进 `App.vue`。当前窗口关闭编排无条件调用 file-manager 的 `before-unload` 保存钩子，再把真实结果投影为 `ready / save_failed`：即使页面没有 dirty 标记，录音等外部状态也必须有机会停止并落盘。失败或异常都保持窗口，主进程不能用 timeout 猜测成功。

App 根组件在任何插件初始化等待前注册监听并声明 renderer 就绪。preload 为每个 document 生成独立页面会话，renderer 回应原样携带主进程给出的唯一请求编号；Renderer 通过 browser-safe 公共说明符 `@linnya/app-lifecycle-contract` 消费协议，canonical owner 仍是 `src/shared/app-lifecycle/definitions/windowCloseProtocol.ts`。

进程停止、App 退出和命令 owner 收口不属于 renderer；renderer 只报告保存结果并等待 Main 的 typed shutdown 请求。
