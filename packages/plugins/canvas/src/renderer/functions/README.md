# Renderer 表面投影规则

本目录只放表面级纯规则。菜单动作由 createCanvasPageCommands 连接现有表面能力，卡片、连线及布局业务仍在各 feature。

canvasSelectionToolbarStyle 将世界选区投到屏幕：浮条位于上方10px；与顶部胶囊不足8px时改到选区下方10px，不通过向内钳位遮住卡片。默认尺寸对应现有工具栏CSS，调用方可传实测 toolbarHeight/capsuleBottom；缩放只影响选区，不改变屏幕间距。

canvasMenuActions 复用 renderer-ui 正式 children 子菜单合同。canvasColorMenuOptions 是卡片菜单/浮条的同源颜色标签，菜单值为 color:<颜色>，color字段供浮条转换为正式CanvasColor。连线颜色仍由 connections owner 的独立菜单解析；颜色动作不绕开表面正式用户提交。所选自动排布和空白自动排布共用现有 arrange，选择范围由表面读取当前选择决定。
