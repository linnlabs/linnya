import { app } from 'electron';

// 即使测试错误地启动了应用，也不得创建窗口或把 UI 验收混入安装器生命周期门。
app.whenReady().then(() => app.quit());
