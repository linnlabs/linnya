# electron-builder 的卸载器会把当前目录设为安装目录；Windows 无法删除
# 进程自己的当前目录。删除文件前切到系统临时目录，避免留下空安装目录 (Windows).
!macro customUnInstall
  SetOutPath "$TEMP"
  # 覆盖更新保留支持组件；真正卸载先完成账户、服务和授权回收。helper 在原用户下
  # 自行申请必要的 UAC，不把普通 Linnya 安装器整体提升为管理员。
  ${ifNot} ${isUpdated}
    ${if} ${FileExists} "$INSTDIR\resources\command-runtime\windows\x64\linnyaCommandIsolation.exe"
      # 卸载正在使用的 helper 不从待删除目录运行。实机中 ExecWait 返回后，
      # 安装路径上的 exe 仍会阻止本次 RMDir；支持工具由 NSIS 临时目录持有。
      InitPluginsDir
      ClearErrors
      CopyFiles /SILENT "$INSTDIR\resources\command-runtime\windows\x64\linnyaCommandIsolation.exe" "$PLUGINSDIR\linnyaCommandIsolation.exe"
      ${if} ${Errors}
        SetErrorLevel 1
        Abort "Cannot prepare Windows command isolation cleanup. Linnya has not been removed."
      ${endif}
      ExecWait '"$PLUGINSDIR\linnyaCommandIsolation.exe" disable' $R0
      ${if} $R0 != 0
        SetErrorLevel $R0
        Abort "Windows command isolation cleanup was cancelled or failed. Linnya has not been removed."
      ${endif}
    ${endif}
  ${endif}
!macroend
