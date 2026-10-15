param(
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [Parameter(Mandatory = $true)][ValidatePattern('^catalog-cover-v[1-9][0-9]*$')][string]$VersionName
)
$ErrorActionPreference = 'Stop'
if ($args.Count -ne 0) { throw 'Unexpected arguments.' }
function Assert-OrdinaryPath([string]$Target) {
  $current = [IO.Path]::GetFullPath($Target)
  while ($current) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked paths are not accepted.' }
    $parent = [IO.Path]::GetDirectoryName($current)
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
}
$sourceItem = Get-Item -LiteralPath $SourcePath -Force -ErrorAction Stop
if ($sourceItem.PSIsContainer -or $sourceItem.Extension -ine '.png') { throw 'A PNG original is required.' }
$source = $sourceItem.FullName
Assert-OrdinaryPath $source
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Assert-OrdinaryPath $taskRoot
$taskOutputRoot = Join-Path $taskRoot 'apps\miniprogram\src\assets\illustrations'
Assert-OrdinaryPath $taskOutputRoot
if (-not (Get-Item -LiteralPath $taskOutputRoot -ErrorAction Stop).PSIsContainer) { throw 'Illustration output directory missing.' }
$destination = [IO.Path]::GetFullPath((Join-Path $taskOutputRoot ($VersionName + '.jpg')))
if ([IO.Path]::GetDirectoryName($destination) -ne $taskOutputRoot) { throw 'Output must remain in the illustration directory.' }
if (Test-Path -LiteralPath $destination) { throw 'Existing cover preserved; select a new versioned name.' }
Add-Type -AssemblyName System.Drawing
# Packaging optimization only: preserve the complete illustration and aspect.
$original = [System.Drawing.Image]::FromFile($source)
$bitmap = $null
$graphics = $null
$parameters = $null
$taskOutputStream = $null
try {
  $width = 1024
  $height = [int][Math]::Round($original.Height * $width / $original.Width)
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($original, 0, 0, $width, $height)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
  if (@($codec).Count -ne 1) { throw 'JPEG encoder unavailable.' }
  $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]85)
  # CreateNew also refuses a destination created after the existence check.
  $taskOutputStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $bitmap.Save($taskOutputStream, $codec, $parameters)
  $taskOutputStream.Dispose()
  $taskOutputStream = $null
  Get-Item -LiteralPath $destination | Select-Object FullName, Length
} finally {
  if ($taskOutputStream) { $taskOutputStream.Dispose() }
  if ($parameters) { $parameters.Dispose() }
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
  $original.Dispose()
}
