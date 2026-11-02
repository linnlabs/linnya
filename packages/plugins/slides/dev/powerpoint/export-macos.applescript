-- 只保存本次打开的合成文稿，绝不 quit 或操作用户的其他 presentation。
on run argv
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    set documentName to item 3 of argv
    set ownedPresentation to missing value
    tell application "Microsoft PowerPoint"
        with timeout of 120 seconds
            if exists presentation documentName then error "Sample is already open; close that sample before exporting again."
            try
                open (POSIX file inputPath)
                set ownedPresentation to presentation documentName
                set officeVersion to version
                -- PDF 导出不经过有 -9074 历史问题的 PNG SaveAs 过滤器。
                save ownedPresentation in (POSIX file outputPath) as save as PDF
                close ownedPresentation saving no
                return officeVersion
            on error messageText number errorNumber
                if ownedPresentation is not missing value then close ownedPresentation saving no
                error messageText number errorNumber
            end try
        end timeout
    end tell
end run
