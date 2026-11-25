!macro customHeader
!ifdef BUILD_UNINSTALLER
  # 最后的 RMDir 可能只删掉部分空目录（例如另一个窗口占用安装根）。
  # 先从暂存树补回目录结构，electron-builder 的 restoreFiles 才能还原文件。
  Function un.linnyaRestoreDirectories
    Exch $R0
    Push $R1
    Push $R2
    FindFirst $R1 $R2 "$PLUGINSDIR\old-install$R0\*.*"
    ${While} $R2 != ""
      ${If} $R2 != "."
      ${AndIf} $R2 != ".."
      ${AndIf} ${FileExists} "$PLUGINSDIR\old-install$R0\$R2\*.*"
        CreateDirectory "$INSTDIR$R0\$R2"
        Push "$R0\$R2"
        Call un.linnyaRestoreDirectories
      ${EndIf}
      FindNext $R1 $R2
    ${EndWhile}
    FindClose $R1
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd
!endif
!macroend

!macro customRemoveFiles
  # 复用升级卸载的暂存和恢复。不能先删注册项再发现 ARM 转译进程还锁着文件。
  CreateDirectory "$PLUGINSDIR\old-install"
  Push ""
  Call un.atomicRMDir
  Pop $R0
  ${If} $R0 == 0
    # 离开安装目录后才能移除目录本身。
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
    # 升级仍沿用 electron-builder 的原位执行策略；整机卸载才提交目录已移除的承诺。
    ${IfNot} ${isUpdated}
    ${AndIf} ${FileExists} "$INSTDIR"
      Push ""
      Call un.linnyaRestoreDirectories
      StrCpy $R0 "$INSTDIR"
    ${EndIf}
  ${EndIf}

  ${If} $R0 != 0
    DetailPrint "Unable to remove: $R0"
    Push ""
    Call un.restoreFiles
    Pop $R0

    # one-click 普通卸载在确认后也进入静默模式，需区分真正的 /S 调用。
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "/S" $R1
    ${If} ${Errors}
      ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
        MessageBox MB_OK|MB_ICONEXCLAMATION "部分程序文件无法移除。请关闭正在使用 Linnya 安装目录的窗口后重试；如果仍然失败，请重启 Windows 后再试。你的数据未被删除。"
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Some program files could not be removed. Close any windows using Linnya's installation folder and try again. If the issue persists, restart Windows and retry. Your data has not been deleted."
      ${EndIf}
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}

  # 系统通知的激活项由应用运行时登记，指向已删除的程序；标识与 configureWindowsAppIdentity.ts 一致。
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\CLSID\{9923EFDD-533C-42B0-9991-1E6D45AA4BAD}"
  ${EndIf}
!macroend
