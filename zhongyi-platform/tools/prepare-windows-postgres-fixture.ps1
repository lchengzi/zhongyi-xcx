param([Parameter(Mandatory = $true)][string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'

# Only the ephemeral GitHub checkout. Never change local account/system ACLs.
if ($env:GITHUB_ACTIONS -ne 'true' -or [string]::IsNullOrWhiteSpace($env:GITHUB_WORKSPACE)) {
  throw 'This permission preparation is only for the isolated GitHub Windows runner.'
}
$workspacePath = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$fixturePath = [IO.Path]::GetFullPath($FixtureDirectory)
$expectedParent = Join-Path $workspacePath 'zhongyi-platform\.local\postgres-tests'
if ((Split-Path -Parent $fixturePath) -ne $expectedParent -or
  (Split-Path -Leaf $fixturePath) -notmatch '^cluster-[A-Za-z0-9_-]{6}$') {
  throw 'Only the exact newly owned PostgreSQL fixture directory is allowed.'
}

function Assert-Ordinary([string]$target) {
  $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) {
    throw 'Linked permission target refused.'
  }
  if ((Resolve-Path -LiteralPath $target -ErrorAction Stop).Path -ne $target) {
    throw 'Redirected permission target refused.'
  }
  return $item
}
$ancestorPath = $fixturePath
while ($ancestorPath) {
  $null = Assert-Ordinary $ancestorPath
  $parentPath = Split-Path -Parent $ancestorPath
  if ($parentPath -eq $ancestorPath) { break }
  $ancestorPath = $parentPath
}

# Walk without -Recurse: inspect a directory before descending into it.
$pendingPaths = [Collections.Generic.Stack[string]]::new()
$pendingPaths.Push($fixturePath)
$checkedTargets = 0
while ($pendingPaths.Count -gt 0) {
  $currentPath = $pendingPaths.Pop()
  $item = Assert-Ordinary $currentPath
  if ($currentPath -ne $fixturePath -and -not $currentPath.StartsWith($fixturePath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Permission target escaped the owned fixture.'
  }
  $checkedTargets += 1
  if ($item.PSIsContainer) {
    foreach ($child in Get-ChildItem -LiteralPath $currentPath -Force -ErrorAction Stop) {
      $null = Assert-Ordinary $child.FullName
      $pendingPaths.Push($child.FullName)
    }
  }
}

# A restricted administrator token no longer receives Administrators-group
# access. Give only the SAME user SID Modify access to its disposable cluster,
# including the Node-created server log opened by pg_ctl's restricted cmd.exe.
$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $fixturePath -ErrorAction Stop
$rule = [Security.AccessControl.FileSystemAccessRule]::new($currentUserSid,
  [Security.AccessControl.FileSystemRights]::Modify,
  [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
  [Security.AccessControl.PropagationFlags]::None,
  [Security.AccessControl.AccessControlType]::Allow)
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $fixturePath -AclObject $acl -ErrorAction Stop
$actualAcl = Get-Acl -LiteralPath $fixturePath -ErrorAction Stop
$matched = @($actualAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object {
  $_.IdentityReference -eq $currentUserSid -and $_.AccessControlType -eq 'Allow' -and
  ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify
})
if ($matched.Count -ne 1) { throw 'Exact owner permission rule was not verified.' }
Write-Output ('Owned GitHub PostgreSQL fixture permission prepared; inspected targets: ' + $checkedTargets + '. No system user/service or package ACL changed.')
