$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$version = "0.1.31"
$canonicalPackager = Join-Path $PSScriptRoot "package-xhs-browser-extension.ps1"
$exportPath = Join-Path $repositoryRoot "exports\xhs-browser-extension-$version.zip"
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "public\downloads"))
$productionOutputPath = [System.IO.Path]::GetFullPath((Join-Path $outputDirectory "xhs-browser-extension-$version.zip"))
$expectedPrefix = $outputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $productionOutputPath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Extension archive must stay inside public\downloads."
}

function Publish-ExtensionArchive([string]$Destination) {
  & $canonicalPackager -AppOrigin "https://xhstw.qycm.top" -AdditionalAppOrigins @("http://127.0.0.1:3000") -Version $version
  if (-not (Test-Path -LiteralPath $exportPath -PathType Leaf)) {
    throw "Extension packaging failed. Canonical archive was not created: $exportPath"
  }

  Copy-Item -LiteralPath $exportPath -Destination $Destination -Force
  $hash = Get-Sha256Hex $Destination
  Write-Output "Extension archive: $Destination"
  Write-Output "SHA-256: $hash"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Publish-ExtensionArchive -Destination $productionOutputPath
