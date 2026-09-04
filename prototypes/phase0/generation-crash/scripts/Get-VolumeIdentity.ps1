param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$full = [System.IO.Path]::GetFullPath($LiteralPath)
$root = [System.IO.Path]::GetPathRoot($full)
$drive = [System.IO.DriveInfo]::new($root)

[ordered]@{
    root = $root
    drive_type = [string]$drive.DriveType
    format = [string]$drive.DriveFormat
    ready = [bool]$drive.IsReady
} | ConvertTo-Json -Compress
