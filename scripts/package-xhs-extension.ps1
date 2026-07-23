$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$version = "0.1.11"
$canonicalPackager = Join-Path $PSScriptRoot "package-xhs-browser-extension.ps1"
$exportPath = Join-Path $repositoryRoot "exports\xhs-browser-extension-$version.zip"
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "public\downloads"))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $outputDirectory "xhs-browser-extension-$version.zip"))
$expectedPrefix = $outputDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Extension archive must stay inside public\downloads."
}

& $canonicalPackager -AppOrigin "https://xhstw.qycm.top" -Version $version
if (-not (Test-Path -LiteralPath $exportPath -PathType Leaf)) {
  throw "Extension packaging failed. Canonical archive was not created: $exportPath"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Copy-Item -LiteralPath $exportPath -Destination $outputPath -Force
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath

Write-Output "Extension archive: $outputPath"
Write-Output "SHA-256: $($hash.Hash)"
