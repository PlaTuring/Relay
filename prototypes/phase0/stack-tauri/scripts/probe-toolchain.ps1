$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ApplicationCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    return Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Get-CommandVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Arguments = @('--version')
    )

    $command = Get-ApplicationCommand -Name $Name
    if ($null -eq $command) {
        return $null
    }

    try {
        $output = & $command.Source @Arguments 2>$null | Select-Object -First 1
        $version = ([string]$output).Trim()
        if ([string]::IsNullOrWhiteSpace($version)) {
            return $null
        }
        return $version
    }
    catch {
        return $null
    }
}

function Test-KnownDirectory {
    param([Parameter(Mandatory = $true)][string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return $true
        }
    }
    return $false
}

function Get-MachineWebViewVersion {
    $clientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $keys = @(
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId"
    )

    foreach ($key in $keys) {
        try {
            $value = Get-ItemPropertyValue -LiteralPath $key -Name 'pv' -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
                return ([string]$value).Trim()
            }
        }
        catch {
            # Missing machine registration is a supported negative result.
        }
    }
    return $null
}

$programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
$programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$windowsSdkCandidates = @(
    (Join-Path $programFilesX86 'Windows Kits\10\bin'),
    (Join-Path $programFiles 'Windows Kits\10\bin')
)
$visualStudioCandidates = @(
    (Join-Path $programFilesX86 'Microsoft Visual Studio\2022\BuildTools'),
    (Join-Path $programFilesX86 'Microsoft Visual Studio\2022\Community'),
    (Join-Path $programFilesX86 'Microsoft Visual Studio\2022\Professional'),
    (Join-Path $programFilesX86 'Microsoft Visual Studio\2022\Enterprise'),
    (Join-Path $programFiles 'Microsoft Visual Studio\2022\BuildTools'),
    (Join-Path $programFiles 'Microsoft Visual Studio\2022\Community'),
    (Join-Path $programFiles 'Microsoft Visual Studio\2022\Professional'),
    (Join-Path $programFiles 'Microsoft Visual Studio\2022\Enterprise')
)

$webViewVersion = Get-MachineWebViewVersion
$result = [ordered]@{
    schemaVersion = '1.0.0'
    probeKind = 'read-only-sanitized-host-toolchain'
    operatingSystem = [ordered]@{
        platform = 'windows'
        version = [Environment]::OSVersion.Version.ToString()
        architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    }
    harness = [ordered]@{
        pwsh = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'pwsh.exe')
            version = Get-CommandVersion -Name 'pwsh.exe'
        }
    }
    javascript = [ordered]@{
        node = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'node.exe')
            version = Get-CommandVersion -Name 'node.exe'
        }
        npm = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'npm.cmd')
            version = Get-CommandVersion -Name 'npm.cmd'
        }
        tauriCli = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'tauri.cmd')
            version = Get-CommandVersion -Name 'tauri.cmd'
        }
    }
    rust = [ordered]@{
        rustc = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'rustc.exe')
            version = Get-CommandVersion -Name 'rustc.exe'
        }
        cargo = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'cargo.exe')
            version = Get-CommandVersion -Name 'cargo.exe'
        }
        rustup = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'rustup.exe')
            version = Get-CommandVersion -Name 'rustup.exe'
        }
        cargoTauri = [ordered]@{
            present = $null -ne (Get-ApplicationCommand -Name 'cargo-tauri.exe')
            version = Get-CommandVersion -Name 'cargo-tauri.exe'
        }
    }
    nativeBuild = [ordered]@{
        clPresent = $null -ne (Get-ApplicationCommand -Name 'cl.exe')
        linkPresent = $null -ne (Get-ApplicationCommand -Name 'link.exe')
        msbuildPresent = $null -ne (Get-ApplicationCommand -Name 'msbuild.exe')
        vswherePresent = $null -ne (Get-ApplicationCommand -Name 'vswhere.exe')
        signtoolPresent = $null -ne (Get-ApplicationCommand -Name 'signtool.exe')
        windowsSdkKnownRootPresent = Test-KnownDirectory -Candidates $windowsSdkCandidates
        visualStudio2022KnownRootPresent = Test-KnownDirectory -Candidates $visualStudioCandidates
    }
    webView2 = [ordered]@{
        machineRuntimePresent = $null -ne $webViewVersion
        version = $webViewVersion
        registrationScope = if ($null -ne $webViewVersion) { 'machine' } else { $null }
    }
    guarantees = [ordered]@{
        fileWrites = $false
        networkAccess = $false
        toolchainMutation = $false
        privatePathsEmitted = $false
    }
}

$result | ConvertTo-Json -Depth 8 -Compress
