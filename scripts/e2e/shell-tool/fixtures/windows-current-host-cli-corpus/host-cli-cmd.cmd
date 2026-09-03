@echo off
echo CMD_STDOUT:%~1
echo CMD_STDERR:%~2 1>&2
exit /b 0
