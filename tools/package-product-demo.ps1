param([Parameter(Mandatory = $true)][string]$RunId)
$ErrorActionPreference = 'Stop'
if ($RunId -notmatch '^run-[A-Za-z0-9]{6}$') { throw 'Use an actual generated recording ID, not a path' }
$demoWorkspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$demoParent = Join-Path $demoWorkspace '.refactor/evidence/product-demo-runs'
$demoRoot = Join-Path $demoParent $RunId
function Assert-DemoOrdinaryPath([string]$Path, [bool]$Directory) {
  $demoCursor = [System.IO.Path]::GetFullPath($Path)
  if ($demoCursor -ne $demoWorkspace -and -not $demoCursor.StartsWith($demoWorkspace + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside workspace' }
  $demoFirst = $true
  while ($true) {
    $demoInfo = Get-Item -LiteralPath $demoCursor -Force -ErrorAction Stop
    if ($demoInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Links or redirected paths not allowed in demo package' }
    if ($demoFirst -and $demoInfo.PSIsContainer -ne $Directory) { throw 'Unexpected demo asset type' }
    if (-not $demoFirst -and -not $demoInfo.PSIsContainer) { throw 'Ordinary parent directory required' }
    if ($demoCursor -eq $demoWorkspace) { break }
    $demoCursor = [System.IO.Path]::GetDirectoryName($demoCursor); $demoFirst = $false
  }
}
Assert-DemoOrdinaryPath $demoRoot $true
$demoNames = @('index.html','report.json','user-flow.webm','editorial-flow.webm','user-home.png','user-compare.png','editorial-flow.png','user-video-frame.png','editorial-video-frame.png')
$demoFiles = @($demoNames | ForEach-Object { Join-Path $demoRoot $_ }) + @(Join-Path $demoWorkspace 'zhongyi-platform/docs/demo-and-hands-on.md')
if ($demoFiles.Count -ne 10) { throw 'Unexpected package count' }
$demoDigests = @{}
foreach ($demoFile in $demoFiles) {
  Assert-DemoOrdinaryPath $demoFile $false
  $demoInfo = Get-Item -LiteralPath $demoFile
  if ($demoInfo.Length -lt 1 -or $demoInfo.Length -gt 64MB) { throw 'Unexpected package asset size' }
  $demoName = [System.IO.Path]::GetFileName($demoFile)
  if ($demoDigests.ContainsKey($demoName)) { throw 'Duplicate package name' }
  $demoDigests[$demoName] = (Get-FileHash -LiteralPath $demoFile -Algorithm SHA256).Hash
}
$demoReport = Get-Content -LiteralPath (Join-Path $demoRoot 'report.json') -Raw | ConvertFrom-Json
if ($demoReport.status -ne 'passed' -or $demoReport.phase -ne 'complete' -or $demoReport.clips.Count -ne 2 -or $demoReport.applicationStarts -ne 2 -or $demoReport.gracefulStops -ne 2 -or $demoReport.fixturesStopped -ne $true -or $demoReport.workingDatabaseUnchanged -ne $true -or $demoReport.errors.Count) { throw 'Complete isolated runtime proof required' }
if ($demoReport.passwordsRecorded -ne $false -or $demoReport.mobileDevicesVerified -ne $false -or $demoReport.realModelCalls -ne 0 -or $demoReport.actualFoodPhotosPublished -ne 0) { throw 'Recording scope is not the safe local demo' }
foreach ($demoClip in $demoReport.clips) {
  if ($demoClip.filename -notin @('user-flow.webm','editorial-flow.webm') -or $demoClip.playbackVerified -ne $true -or $demoClip.durationSeconds -le 5 -or $demoClip.sha256 -ne $demoDigests[$demoClip.filename]) { throw 'Video evidence or digest mismatch' }
}
$demoArchive = Join-Path $demoParent ('食养图录-演示-' + (Get-Date -Format yyyyMMdd) + '-' + $RunId + '.zip')
if (Test-Path -LiteralPath $demoArchive) { throw 'Do not overwrite a previous package' }
Assert-DemoOrdinaryPath $demoParent $true
Compress-Archive -LiteralPath $demoFiles -DestinationPath $demoArchive -CompressionLevel Optimal -ErrorAction Stop
Assert-DemoOrdinaryPath $demoArchive $false
$demoZip = [System.IO.Compression.ZipFile]::OpenRead($demoArchive)
try {
  if ($demoZip.Entries.Count -ne $demoFiles.Count) { throw 'Archive count mismatch' }
  foreach ($demoEntry in $demoZip.Entries) {
    if (-not $demoDigests.ContainsKey($demoEntry.FullName) -or $demoEntry.Name -ne $demoEntry.FullName) { throw 'Unexpected archive member' }
    $demoStream = $demoEntry.Open(); $demoHasher = [System.Security.Cryptography.SHA256]::Create()
    try { $demoDigest = [Convert]::ToHexString($demoHasher.ComputeHash($demoStream)) }
    finally { $demoStream.Dispose(); $demoHasher.Dispose() }
    if ($demoDigest -ne $demoDigests[$demoEntry.FullName]) { throw 'Archive bytes differ from verified source' }
  }
} finally { $demoZip.Dispose() }
[pscustomobject]@{archive=$demoArchive;bytes=(Get-Item -LiteralPath $demoArchive).Length;files=$demoFiles.Count;sha256=(Get-FileHash -LiteralPath $demoArchive -Algorithm SHA256).Hash;verified=$true;includesCredentials=$false;includesDatabase=$false;includesResearchPhotos=$false;deviceVerified=$false} | ConvertTo-Json -Compress
