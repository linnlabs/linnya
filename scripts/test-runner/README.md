# 测试运行器边界

本目录只承载跨 package 稳定复用的测试启动能力，不登记具体私有插件的 ID、源码路径或测试样本。

- `run-test-with-electron.cjs`：在 Electron Node ABI 下执行普通测试入口。
- `run-vitest-with-electron.cjs`：在 Electron Node ABI 下启动 Vitest。
- `vitest.plugin.config.ts`：让插件建立自己的 Vitest 组合根，同时复用 Host 的通用 alias、Vue 插件和测试环境。

插件自有 package alias 必须写在插件目录内的 `vitest.config.ts`，不能回填根 `vitest.config.ts`。生成器会把插件 alias 放在 Host 的 `@plugin/*` facade 通配规则之前，避免 package scope 被 Host SDK 路径劫持。

这个入口服务当前 monorepo 联调，不代表插件已经能脱离 Linnya checkout 独立测试。物理拆仓前，Host facade 的可分发 testkit、版本兼容范围和独立消费者 smoke 仍需按开源 proposal 完成。
