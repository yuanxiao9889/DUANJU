param(
  [string]$SourceDir,
  [string]$OutputFile
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path

if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  $SourceDir = Join-Path $repoRoot 'build\extensions\seedvr2-complete'
}

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
  $OutputFile = Join-Path $repoRoot 'build\packages\seedvr2-complete-offline.zip'
}

$resolvedSourceDir = (Resolve-Path -LiteralPath $SourceDir).Path
$outputParentDir = Split-Path -Parent $OutputFile
if (-not (Test-Path -LiteralPath $outputParentDir)) {
  New-Item -ItemType Directory -Path $outputParentDir -Force | Out-Null
}

if (Test-Path -LiteralPath $OutputFile) {
  Remove-Item -LiteralPath $OutputFile -Force
}

$sourceParentDir = Split-Path -Parent $resolvedSourceDir
$files = Get-ChildItem -LiteralPath $resolvedSourceDir -Recurse -Force -File
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum

Write-Host "[seedvr2-extension] packaging source -> $resolvedSourceDir"
Write-Host "[seedvr2-extension] packaging target -> $OutputFile"
Write-Host "[seedvr2-extension] file count       -> $($files.Count)"
Write-Host "[seedvr2-extension] total bytes      -> $totalBytes"

$zipStream = [System.IO.File]::Open($OutputFile, [System.IO.FileMode]::CreateNew)
try {
  $archive = New-Object System.IO.Compression.ZipArchive(
    $zipStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )

  try {
    $processedBytes = 0L
    $fileIndex = 0

    foreach ($file in $files) {
      $relativePath = $file.FullName.Substring($sourceParentDir.Length).TrimStart('\', '/')
      $entry = $archive.CreateEntry(
        $relativePath,
        [System.IO.Compression.CompressionLevel]::NoCompression
      )
      $entry.LastWriteTime = [DateTimeOffset]::new($file.LastWriteTimeUtc)

      $inputStream = [System.IO.File]::OpenRead($file.FullName)
      $entryStream = $entry.Open()

      try {
        $inputStream.CopyTo($entryStream)
      } finally {
        $entryStream.Dispose()
        $inputStream.Dispose()
      }

      $processedBytes += $file.Length
      $fileIndex += 1

      if (($fileIndex % 250) -eq 0 -or $fileIndex -eq $files.Count) {
        $progress = if ($totalBytes -gt 0) {
          [math]::Round(($processedBytes / $totalBytes) * 100, 2)
        } else {
          100
        }
        Write-Host "[seedvr2-extension] packaged $fileIndex/$($files.Count) files ($progress%)"
      }
    }
  } finally {
    $archive.Dispose()
  }
} finally {
  $zipStream.Dispose()
}

$outputSize = (Get-Item -LiteralPath $OutputFile).Length
$outputSizeGb = [math]::Round(($outputSize / 1GB), 2)

Write-Host "[seedvr2-extension] archive ready   -> $OutputFile"
Write-Host "[seedvr2-extension] archive size    -> $outputSizeGb GB"
