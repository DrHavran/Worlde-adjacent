# dump.ps1 — concatenate all source files into one txt

$outFile = "dump.txt"
$root    = (Get-Location).Path

# Folders to skip entirely
$skipDirs = @('.git', 'node_modules', 'dist', 'build')

# File extensions to include (add/remove as needed)
$includeExt = @(
    '.html', '.htm',
    '.css', '.scss',
    '.js', '.mjs', '.cjs', '.ts',
    '.json', '.jsonc',
    '.md', '.txt',
    '.ps1', '.sql',
    '.svg'
)

# Files to skip even if the extension matches
$skipFiles = @($outFile, 'dump.ps1', 'package-lock.json')

# Collect
$files = Get-ChildItem -Path $root -Recurse -File |
    Where-Object {
        $dirParts = $_.FullName.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)
        ($dirParts | Where-Object { $skipDirs -contains $_ }).Count -eq 0
    } |
    Where-Object { $includeExt -contains $_.Extension.ToLower() } |
    Where-Object { $skipFiles -notcontains $_.Name } |
    Sort-Object FullName

# Write
Remove-Item $outFile -ErrorAction Ignore
$utf8 = New-Object System.Text.UTF8Encoding $false

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("===== TREE =====")
foreach ($f in $files) {
    [void]$sb.AppendLine($f.FullName.Substring($root.Length + 1))
}
[void]$sb.AppendLine()

foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1)
    [void]$sb.AppendLine("===== $rel =====")
    try {
        [void]$sb.AppendLine((Get-Content -LiteralPath $f.FullName -Raw -ErrorAction Stop))
    } catch {
        [void]$sb.AppendLine("<error reading file: $($_.Exception.Message)>")
    }
    [void]$sb.AppendLine()
}

[IO.File]::WriteAllText((Join-Path $root $outFile), $sb.ToString(), $utf8)

Write-Host "Wrote $($files.Count) files to $outFile"