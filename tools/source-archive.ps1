param([string] $Job = '')
$ErrorActionPreference = 'Stop'

function Assert-ArchiveName([string] $Name) {
    if ([string]::IsNullOrEmpty($Name) -or $Name -match '[\x00-\x1f<>:"\\|?*]' -or $Name.StartsWith('/')) { throw 'Invalid archive name' }
    foreach ($part in $Name.Split('/')) {
        if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Invalid archive name' }
    }
}
function Assert-PlainPath([string] $Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($true) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked archive path refused' }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = $parent.FullName
    }
}
function Assert-ArchiveKind([long] $Attributes) {
    $kind = $Attributes -band 0xF0000000L
    if (($Attributes -band 0x400) -ne 0 -or ($kind -ne 0 -and $kind -ne 0x80000000L -and $kind -ne 0x40000000L)) { throw 'Linked or special archive entry' }
}
function Assert-Inside([string] $Root, [string] $Target) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\','/')) + [IO.Path]::DirectorySeparatorChar
    if (-not [IO.Path]::GetFullPath($Target).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive target outside owned directory' }
}
function Hash-Bytes([byte[]] $Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
# Functions can be loaded by the non-mutating path-regression test.
if ($Job -eq '') { return }

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Assert-PlainPath $workspace
Assert-Inside (Join-Path $workspace '.refactor/deliveries') $Job
Assert-PlainPath $Job
$config = Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json
$evidence = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Job))
if ([IO.Path]::GetFileName($evidence) -notmatch '^source-[a-f0-9-]{36}$') { throw 'Unexpected delivery directory' }
foreach ($target in @($config.archive, $config.inventory, $config.result)) { Assert-Inside $evidence $target }
if (Test-Path -LiteralPath $config.archive) { throw 'Archive already exists' }
if (Test-Path -LiteralPath $config.result) { throw 'Result already exists' }
Assert-PlainPath $config.inventory
$temporary = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($config.source))
if ([IO.Path]::GetFileName($temporary) -notmatch '^food-education-source-export-[a-zA-Z0-9]+$' -or
    [IO.Path]::GetDirectoryName($temporary).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\') -or
    [IO.Path]::GetFileName($config.source) -ne 'source' -or
    [IO.Path]::GetFullPath($config.extracted) -ne [IO.Path]::GetFullPath((Join-Path $temporary 'extracted'))) { throw 'Unexpected temporary directories' }
Assert-PlainPath $config.source
Assert-PlainPath $config.extracted
if (@(Get-ChildItem -LiteralPath $config.extracted -Force).Count -ne 0) { throw 'Extraction directory must be empty' }
function Check-Tree([string] $Path) {
    Assert-PlainPath $Path
    foreach ($entry in Get-ChildItem -LiteralPath $Path -Force) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked staged source refused' }
        if ($entry.PSIsContainer) { Check-Tree $entry.FullName }
    }
}
Check-Tree $config.source
$expected = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
$directories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$inventory = @(Get-Content -LiteralPath $config.inventory -Raw -Encoding UTF8 | ConvertFrom-Json)
foreach ($file in $inventory) {
    Assert-ArchiveName $file.path
    if ($expected.ContainsKey($file.path) -or $file.bytes -lt 0 -or $file.bytes -gt 16777216 -or $file.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid archive inventory' }
    $expected.Add($file.path, $file)
    $parts = $file.path.Split('/')
    for ($index = 1; $index -lt $parts.Length; $index++) { [void]$directories.Add(($parts[0..($index - 1)] -join '/')) }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($config.source, $config.archive, [IO.Compression.CompressionLevel]::Optimal, $false)
Assert-PlainPath $config.archive
# Keep the file exclusively open during inspection and extraction. Never use a
# generic ExtractToDirectory against unchecked names or overwrite existing files.
$handle = [IO.File]::Open($config.archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
$zip = [IO.Compression.ZipArchive]::new($handle, [IO.Compression.ZipArchiveMode]::Read, $false)
try {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $files = @()
    foreach ($entry in $zip.Entries) {
        $directory = $entry.FullName.EndsWith('/')
        $name = if ($directory) { $entry.FullName.Substring(0, $entry.FullName.Length - 1) } else { $entry.FullName }
        Assert-ArchiveName $name
        if (-not $seen.Add($name)) { throw 'Duplicate archive entry' }
        Assert-ArchiveKind $entry.ExternalAttributes
        if ($directory) { if (-not $directories.Contains($name) -or $entry.Length -ne 0) { throw 'Unexpected archive directory' }; continue }
        if (-not $expected.ContainsKey($name) -or $entry.Length -ne $expected[$name].bytes) { throw 'Unexpected archive file or size' }
        $files += $entry
    }
    if ($files.Count -ne $expected.Count) { throw 'Archive is missing required files' }
    foreach ($entry in $files) {
        $descriptor = $expected[$entry.FullName]
        $inputStream = $entry.Open(); $memory = [IO.MemoryStream]::new(); $buffer = [byte[]]::new(81920); $total = 0
        try {
            while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $total += $count
                if ($total -gt $descriptor.bytes) { throw 'Expanded archive data exceeds inventory' }
                $memory.Write($buffer, 0, $count)
            }
            $bytes = $memory.ToArray()
        } finally { $inputStream.Dispose(); $memory.Dispose() }
        if ($total -ne $descriptor.bytes -or (Hash-Bytes $bytes) -ne $descriptor.sha256) { throw 'Archive data digest mismatch' }
        $target = [IO.Path]::GetFullPath((Join-Path $config.extracted $entry.FullName))
        Assert-Inside $config.extracted $target
        $parent = [IO.Path]::GetDirectoryName($target)
        [void][IO.Directory]::CreateDirectory($parent); Assert-PlainPath $parent
        $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $outputStream.Write($bytes, 0, $bytes.Length) } finally { $outputStream.Dispose() }
    }
    $result = @{ status = 'passed'; files = $files.Count; exactInventory = $true; allEntryDigestsMatched = $true; extractedFreshDirectory = $true; overwritesPerformed = $false }
    $encoded = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json))
    $stream = [IO.File]::Open($config.result, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($encoded, 0, $encoded.Length) } finally { $stream.Dispose() }
} finally { $zip.Dispose(); $handle.Dispose() }
