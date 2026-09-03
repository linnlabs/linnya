# 开发态插件 Renderer 依赖预构建

这个 feature 负责发现 workspace 插件主动声明的 Vite 依赖预构建输入。

插件 Renderer 通过运行期动态 `import` 进入 Host，Vite 启动扫描不一定及时发现它的全部依赖。确实需要避免首次加载后重新优化并刷新页面的依赖，由插件 owner 在自身 `package.json` 的 Linnya 开发元数据中声明；Host 配置只调用通用发现函数，不保存插件 ID、插件路径或具体实现依赖。

声明项必须同时属于该插件自己的 dependencies、devDependencies、optionalDependencies 或 peerDependencies。禁止只把包安装在根目录，再利用 workspace 提升规则让插件隐式借用；这种 phantom dependency 在公共 clean root 或独立插件开发中不可复现。

该字段只影响本地源码开发体验，不属于生产插件准入、artifact 外部依赖合同或公共 API。是否需要预构建必须以真实首次加载行为为证据，不要把插件全部依赖机械复制进去。
