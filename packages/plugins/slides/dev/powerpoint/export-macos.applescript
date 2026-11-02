-- 只保存本次打开的合成文稿，绝不 quit 或操作用户的其他 presentation。
-- AppleScript open 对本机 PowerPoint 返回 -9074，文稿由调用方用 open -a 打开后在这里等待。
on run argv
    set outputPath to item 1 of argv
    set documentName to item 2 of argv
    tell application "Microsoft PowerPoint"
        with timeout of 120 seconds
            set ownedPresentation to missing value
            repeat 60 times
                if exists presentation documentName then
                    set ownedPresentation to presentation documentName
                    exit repeat
                end if
                delay 1
            end repeat
            if ownedPresentation is missing value then error "Sample did not open in PowerPoint"
            try
                set officeVersion to version
                save ownedPresentation in (POSIX file outputPath) as save as PDF
                close ownedPresentation saving no
                return officeVersion
            on error messageText number errorNumber
                close ownedPresentation saving no
                error messageText number errorNumber
            end try
        end timeout
    end tell
end run
