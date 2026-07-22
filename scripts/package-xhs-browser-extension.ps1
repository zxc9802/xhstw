param(
  [Parameter(Mandatory = $true)]
  [string]$AppOrigin,
  [string]$Version = "0.1.0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d{1,5}(?:\.\d{1,5}){0,3}$') {
  throw "Version must contain one to four dot-separated integers."
}
foreach ($part in $Version.Split('.')) {
  if ([int]$part -gt 65535) { throw "Each version component must be at most 65535." }
}

try {
  $originUri = [Uri]$AppOrigin
} catch {
  throw "AppOrigin must be an absolute URL origin."
}
if (-not $originUri.IsAbsoluteUri -or $originUri.UserInfo) {
  throw "AppOrigin must be an absolute URL origin without credentials."
}
if ($originUri.AbsolutePath -ne '/' -or $originUri.Query -or $originUri.Fragment) {
  throw "AppOrigin must not contain a path, query, or fragment."
}
$isDevelopmentOrigin = $originUri.Scheme -eq 'http' -and $originUri.Host -eq '127.0.0.1' -and $originUri.Port -eq 3000
if ($originUri.Scheme -ne 'https' -and -not $isDevelopmentOrigin) {
  throw "AppOrigin must use HTTPS. Only http://127.0.0.1:3000 is allowed for development."
}
$normalizedOrigin = $originUri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exportsRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'exports'))
$stagingPath = [IO.Path]::GetFullPath((Join-Path $exportsRoot "xhs-browser-extension-$Version"))
$zipPath = [IO.Path]::GetFullPath("$stagingPath.zip")
$exportsPrefix = $exportsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

function Assert-SafeExportPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($exportsPrefix, [StringComparison]::OrdinalIgnoreCase) -or $resolved -eq $exportsRoot) {
    throw "Refusing to modify a path outside the repository exports directory: $resolved"
  }
  return $resolved
}

$stagingPath = Assert-SafeExportPath $stagingPath
$zipPath = Assert-SafeExportPath $zipPath
New-Item -ItemType Directory -Path $exportsRoot -Force | Out-Null
if (Test-Path -LiteralPath $stagingPath) { Remove-Item -LiteralPath $stagingPath -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null

foreach ($file in @('background.js', 'app-bridge.js', 'xhs-content.js')) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "browser-extension\$file") -Destination (Join-Path $stagingPath $file)
}
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'browser-extension\shared') -Destination (Join-Path $stagingPath 'shared') -Recurse
$installGuideName = ([string][char]0x5B89) + ([char]0x88C5) + ([char]0x8BF4) + ([char]0x660E) + '.md'
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs\xhs-browser-extension-install.md') -Destination (Join-Path $stagingPath $installGuideName)

$manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'browser-extension\manifest.template.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.version = $Version
$appMatchPattern = "$normalizedOrigin/*"
$manifest.host_permissions = @($manifest.host_permissions | ForEach-Object { if ($_ -eq '__APP_MATCH_PATTERN__') { $appMatchPattern } else { $_ } })
foreach ($contentScript in $manifest.content_scripts) {
  $contentScript.matches = @($contentScript.matches | ForEach-Object { if ($_ -eq '__APP_MATCH_PATTERN__') { $appMatchPattern } else { $_ } })
}
$manifestJson = $manifest | ConvertTo-Json -Depth 20
if ($manifestJson.Contains('__APP_MATCH_PATTERN__')) { throw "Manifest still contains the app-origin placeholder." }
[IO.File]::WriteAllText((Join-Path $stagingPath 'manifest.json'), $manifestJson, [Text.UTF8Encoding]::new($false))

Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $zipPath -Force
$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
Write-Output "ZIP: $zipPath"
Write-Output "SHA256: $($hash.Hash)"
