@echo off
echo BAT_STDOUT:%~1
echo BAT_STDERR:%~2 1>&2
exit /b 37
