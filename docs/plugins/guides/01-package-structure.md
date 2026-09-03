# 01 · 包结构与文件体系

> 适用场景：新建插件包；调整插件目录结构或公开入口；决定一个依赖该放哪。

## 目录布局

```text
packages/plugins/<plugin-id>/
  plugin.json
  package.json
  assets/
  resources/            # skill 等随包资源（可选）
  src/
    shared/             # 入口为 shared/index.ts
    backend/            # 含 index.ts（contribution 装配）与 test-support.ts（测试专用导出）
    renderer/
  host-types/           # 可选：仅放 renderer 环境声明 / 插件自有引擎 ambient，不镜像 host 类型
  dev/                  # 开发辅助脚本（不进 artifact）
  dist/
    backend/
    renderer/
    artifacts/
```

约定：

- `src/shared` 放跨进程共享契约（纯 DTO、常量、纯函数），必须保持 Node-free、Vue-free。
- `src/backend` 放主进程能力：工具、agent、plugin migrations、IPC handler、document hook。
- `src/renderer` 放前端 surface、file handler、工具卡、渲染端 ports 和 UI domain。
- `dev/` 放 showcase / seed 等开发辅助脚本，允许显式消费 host 服务，但不进入生产 `src` 或发布 artifact。
- 包外只允许通过公开入口消费插件能力，不允许 deep import 插件内部文件。
- 插件包调用宿主能力必须走 `@plugin/backend/*` 或 `@plugin/renderer/*` 窄门面（见 [11 宿主门面](./11-host-facades.md)）。这些门面的类型真源是契约包 `@linnya/plugin-host-contract`：插件 `tsconfig.json` 用通配 `paths` 把 `@plugin/{backend,renderer}/*` 映射到契约包,typecheck/IDE 由它消费。**禁止再用 `host-types/hostImports.d.ts` 之类手写桩镜像 host 类型**（已删并有守卫禁止复活）；新增门面先改契约包，见 [11 宿主门面](./11-host-facades.md)。

## 公开入口

命名约定（三面各一个）：

- `@plugin/<id>/shared`
- `@plugin/<id>/backend`
- `@plugin/<id>/renderer`

规则：

- 每个插件按同样口径提供公开入口，并同步 tsconfig、Vite、Vitest 和构建脚本。`exports`、`tsconfig paths`、Vite alias 中的 `shared` 必须指向文件 `src/shared/index.ts`，不要映射到目录 `src/shared`（曾因目录 alias 误吞 `@plugin/<id>/shared/*` 深导入）。
- 主 `backend` 入口只导出 contribution 装配所需内容；persistence、engine 内部类不要从主入口 re-export。测试需要的 persistence/engine fixture 放 `src/backend/test-support.ts`，通过独立子入口 `@plugin/<id>/backend-test-support` 暴露；host 测试经该子入口消费，不走主 `backend`。
- 重型插件可拆出更窄的 backend-only 子入口（如 `@plugin/<id>/backend-coordinator`），避免大入口回流；但**子入口数量要克制**——每个子入口都要写清职责和允许的消费方向，职责重叠的入口必须合并（参见审计 S-12）。
- 入口与守卫同步：新增/删除入口必须同步 `package.json` exports、根 `tsconfig.json` paths、vitest alias 和 `scripts/guards/agent-package-boundary-guard.rules.ts`。

## 依赖归属

- **插件专属运行时依赖必须声明在插件自己的 `package.json`**，并在构建时打进产物或写明 external 策略；不要挂在仓库根 `package.json` 让磁盘 artifact 隐式依赖 monorepo（参见审计 D-01）。
- 根 `package.json` 只保留平台级依赖。
- 插件专属的 npm scripts 放插件包内；根目录只保留按 `<id>` 模板的转发命令（参见审计 D-02）。

## shared 的纪律

- 判断口径：纯 DTO / 纯函数进 `shared`，Node / Buffer / DB / 沙箱进 `backend`，Vue / Pinia / DOM 进 `renderer`。
- shared 不是杂物间：单文件接近 800 行时优先按 feature 拆 `definitions/`，不要继续堆 barrel。
- 同一常量 / 类型只能有一个定义点；renderer 需要时从 `@plugin/<id>/shared` import，不要复制一份改字段名（参见审计 S-09 的尺寸常量三处分裂教训）。
