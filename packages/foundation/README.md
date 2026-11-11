# @linnya/foundation

界面、Backend 和插件都能用的零依赖纯函数。这里只放与产品业务无关、到处都要用的机械小工具，目的是让它们只有一份实现和一份测试。什么该放这里、什么不该放，见[代码质量：不重复实现](../../docs/development/code-quality.md)。

## 边界

可以放：不依赖 Node、DOM、Electron、任何 npm 包，也不读时间、语言、环境变量的纯函数。

不放：

- 跨进程数据合同和必须前后端一致的显示规则，归 [`@app/schemas`](../schemas/README.md)；
- 文件、路径、进程、日志，归 `src/shared`；
- 界面组件与交互，归 [`@linnya/renderer-ui`](../renderer-ui/README.md)；
- 任何带业务词的函数。

每个函数一个文件，从 `src/index.ts` 导出，测试在 `__tests__/`。新增函数时在下面的清单加一行，并把对应的本地写法加进 `guard:shared-implementations` 的名单。

## 已有能力

| 函数 | 作用 |
| --- | --- |
| `isRecord(value)` | 非 null 且不是数组的对象；不代替数据 schema 校验 |
| `isObjectLike(value)` | 非 null 对象，包含数组和类实例；用于宿主能力、错误对象与既有宽松边界 |
| `clamp(value, min, max)` | 把数值限制在范围内 |
| `sleep(milliseconds)` | 等待若干毫秒 |
| `errorToString(error)` | 原样提取错误消息或转为字符串；不生成业务文案 |


## 构建接入

这是编译期源码包，Host 与插件产物将函数内联，不要求安装时解析 TypeScript。独立插件覆盖 `compilerOptions.paths` 时，也要登记 `@linnya/foundation`；验收需要覆盖其独立 esbuild/worker 自检，不能只验证 Host 的解析配置。


带独立 `rootDir` 的产物包可先运行 `build:types`，通过 `tsconfig.build.json` project reference 读取生成声明，避免把 Foundation 实现并入调用包的声明目录。Schemas 在自己的制品构建中内联所用纯函数；这是生成物，不是第二份源码实现。
