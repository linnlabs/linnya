未来可能的slashmenu的相关定义
src/
└── renderer/
    ├── components/
    │   └── SlashMenu/
    │       ├── SlashMenuView.vue          # 主视图组件
    │       ├── SlashMenuItem.vue          # 单个菜单项组件
    │       ├── SlashMenuGroup.vue         # 菜单分组组件
    │       ├── SlashMenuSearch.vue        # 搜索输入组件
    │       └── SlashMenuHint.vue          # 键盘快捷键提示组件
    │
    ├── extensions/
    │   └── slashMenu/
    │       ├── index.js                   # 扩展主入口
    │       ├── SlashMenuExtension.js      # Tiptap扩展主类
    │       ├── SlashMenuPlugin.js         # ProseMirror插件
    │       │
    │       ├── items/                     # 菜单项定义目录
    │       │   ├── index.js               # 统一导出
    │       │   ├── BaseItems.js           # 基础块项目(段落、标题)
    │       │   ├── ListItems.js           # 列表相关项目
    │       │   ├── MediaItems.js          # 媒体相关项目
    │       │   ├── AIItems.js             # AI功能相关项目
    │       │   └── CustomItems.js         # 用户自定义项目
    │       │
    │       ├── providers/                 # 菜单数据提供者
    │       │   ├── index.js               # 统一导出
    │       │   ├── BasicProvider.js       # 基础类型提供者
    │       │   ├── ConversionProvider.js  # 与menubar转换功能整合
    │       │   └── AIProvider.js          # AI功能提供者
    │       │
    │       ├── utils/                     # 工具函数
    │       │   ├── MenuPosition.js        # 菜单位置计算
    │       │   ├── KeyboardNavigation.js  # 键盘导航逻辑
    │       │   ├── SearchFilter.js        # 搜索过滤器
    │       │   └── IconRegistry.js        # 图标注册
    │       │
    │       ├── commands/                  # 菜单命令
    │       │   ├── index.js               # 统一导出
    │       │   ├── BlockCommands.js       # 块操作命令
    │       │   ├── AICommands.js          # AI相关命令
    │       │   └── IntegrationCommands.js # 与其他功能集成的命令
    │       │
    │       └── types/                     # 类型定义
    │           └── SlashMenuTypes.js      # 菜单类型定义
    │
    └── hooks/
        └── useSlashMenu.js                # 组合式API，提供菜单状态和方法
    
└── assets/
    └── styles/
        └── components/
            └── slashMenu/
                ├── SlashMenu.css          # 主菜单样式 
                ├── SlashMenuItem.css      # 菜单项样式
                ├── SlashMenuGroup.css     # 分组样式
                ├── SlashMenuSearch.css    # 搜索框样式
                └── animations.css         # 动画效果样式
