param([string]$InputPath, [string]$OutputDirectory, [int]$Width, [int]$Height, [int]$PageCount)
$ErrorActionPreference = 'Stop'
$presentation = $null
$powerpoint = New-Object -ComObject PowerPoint.Application
try {
    # COM 只持有本次文稿；不调用 Quit，避免关闭同进程中的其他用户文稿。
    $presentation = $powerpoint.Presentations.Open($InputPath, $true, $false, $false)
    if ($presentation.Slides.Count -ne $PageCount) { throw 'Slide count differs from manifest' }
    for ($i = 1; $i -le $PageCount; $i++) {
        $target = Join-Path $OutputDirectory ('slide-{0:D3}.png' -f $i)
        $presentation.Slides.Item($i).Export($target, 'PNG', $Width, $Height)
    }
    Write-Output $powerpoint.Version
} finally {
    if ($null -ne $presentation) { $presentation.Close(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint)
}
