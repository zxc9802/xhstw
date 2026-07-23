$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$extensionDirectoryName = -join @([char]0x6269, [char]0x5C55)
$installGuideFileName = (-join @([char]0x5B89, [char]0x88C5, [char]0x8BF4, [char]0x660E)) + ".md"
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $extensionDirectoryName))
$manifestPath = Join-Path $sourceRoot "manifest.json"
$requiredFiles = @(
  "manifest.json",
  "background.js",
  "app-bridge.js",
  "xhs-content.js",
  "shared\protocol.js",
  "shared\collector.js",
  "shared\task-state.js",
  $installGuideFileName
)

foreach ($relativePath in $requiredFiles) {
  $candidate = Join-Path $sourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Extension packaging failed. Missing file: $relativePath"
  }
}

$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Extension packaging failed. Invalid manifest version: $version"
}

$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "public\downloads"))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $outputDirectory "xhs-browser-extension-$version.zip"))
$expectedPrefix = $outputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Extension archive must stay inside public\downloads."
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}

Compress-Archive -Path (Join-Path $sourceRoot "*") -DestinationPath $outputPath -CompressionLevel Optimal
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath

Write-Output "Extension archive: $outputPath"
Write-Output "SHA-256: $($hash.Hash)"
