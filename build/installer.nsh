# electron-builder 的卸载器会把当前目录设为安装目录；Windows 无法删除
# 进程自己的当前目录。删除文件前切到系统临时目录，避免留下空安装目录 (Windows).
!macro customUnInstall
  SetOutPath "$TEMP"
!macroend
