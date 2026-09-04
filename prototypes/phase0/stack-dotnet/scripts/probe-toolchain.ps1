$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ApplicationCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    return Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
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

function Get-DotnetSdkVersions {
    param([Parameter(Mandatory = $true)][string]$DotnetExecutable)

    $lines = & $DotnetExecutable --list-sdks 2>$null
    $versions = @()
    foreach ($line in @($lines)) {
        if ([string]$line -match '^([^\s]+)\s+\[') {
            $versions += $Matches[1]
        }
    }
    return @($versions)
}

function Get-DotnetRuntimeVersions {
    param([Parameter(Mandatory = $true)][string]$DotnetExecutable)

    $lines = & $DotnetExecutable --list-runtimes 2>$null
    $items = @()
    foreach ($line in @($lines)) {
        if ([string]$line -match '^([^\s]+)\s+([^\s]+)\s+\[') {
            $items += [ordered]@{
                name = $Matches[1]
                version = $Matches[2]
            }
        }
    }
    return @($items)
}

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'

$programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
$programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$windowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
$dotnet = Get-ApplicationCommand -Name 'dotnet.exe'
$sdkVersions = @()
$runtimeVersions = @()
$dotnetHostVersion = $null
if ($null -ne $dotnet) {
    $sdkVersions = @(Get-DotnetSdkVersions -DotnetExecutable $dotnet.Source)
    $runtimeVersions = @(Get-DotnetRuntimeVersions -DotnetExecutable $dotnet.Source)
    $dotnetHostVersion = (Get-Item -LiteralPath $dotnet.Source).VersionInfo.ProductVersion
}

$windowsSdkCandidates = @(
    (Join-Path $programFilesX86 'Windows Kits\10'),
    (Join-Path $programFiles 'Windows Kits\10')
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
$referencePackCandidates = @(
    (Join-Path $programFilesX86 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8'),
    (Join-Path $programFilesX86 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8.1')
)
$legacyFrameworkRoot = Join-Path $windowsRoot 'Microsoft.NET\Framework64\v4.0.30319'
$legacyNdp = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue

$windowsDesktopRuntimePresent = @($runtimeVersions | Where-Object {
    $_.name -eq 'Microsoft.WindowsDesktop.App'
}).Count -gt 0
$windowsSdkPresent = Test-KnownDirectory -Candidates $windowsSdkCandidates
$visualStudioPresent = Test-KnownDirectory -Candidates $visualStudioCandidates

$result = [ordered]@{
    schemaVersion = '1.0.0'
    probeKind = 'read-only-sanitized-dotnet-toolchain'
    operatingSystem = [ordered]@{
        platform = 'windows'
        version = [Environment]::OSVersion.Version.ToString()
        architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    }
    modernDotnet = [ordered]@{
        hostPresent = $null -ne $dotnet
        hostProductVersion = $dotnetHostVersion
        sdkPresent = $sdkVersions.Count -gt 0
        sdkVersions = @($sdkVersions)
        runtimes = @($runtimeVersions)
        windowsDesktopRuntimePresent = $windowsDesktopRuntimePresent
        frameworkDependentPublishSupported = $sdkVersions.Count -gt 0 -and $windowsDesktopRuntimePresent
        selfContainedPublishSupported = $sdkVersions.Count -gt 0
    }
    nativeBuild = [ordered]@{
        msbuildOnPathPresent = $null -ne (Get-ApplicationCommand -Name 'msbuild.exe')
        vswhereOnPathPresent = $null -ne (Get-ApplicationCommand -Name 'vswhere.exe')
        signtoolOnPathPresent = $null -ne (Get-ApplicationCommand -Name 'signtool.exe')
        makeappxOnPathPresent = $null -ne (Get-ApplicationCommand -Name 'makeappx.exe')
        windowsSdkKnownRootPresent = $windowsSdkPresent
        visualStudio2022KnownRootPresent = $visualStudioPresent
        winUiBuildSupported = $sdkVersions.Count -gt 0 -and $visualStudioPresent
        msixBuildSupported = $windowsSdkPresent
    }
    legacyFramework = [ordered]@{
        registryVersion = if ($null -ne $legacyNdp) { [string]$legacyNdp.Version } else { $null }
        registryRelease = if ($null -ne $legacyNdp) { [int]$legacyNdp.Release } else { $null }
        compilerPresent = Test-Path -LiteralPath (Join-Path $legacyFrameworkRoot 'csc.exe') -PathType Leaf
        legacyMsbuildPresent = Test-Path -LiteralPath (Join-Path $legacyFrameworkRoot 'MSBuild.exe') -PathType Leaf
        wpfRuntimeAssembliesPresent = Test-Path -LiteralPath (Join-Path $legacyFrameworkRoot 'WPF\PresentationFramework.dll') -PathType Leaf
        referenceTargetingPackPresent = Test-KnownDirectory -Candidates $referencePackCandidates
        acceptedAsModernSdkSubstitute = $false
    }
    guarantees = [ordered]@{
        fileWrites = $false
        networkAccess = $false
        toolchainMutation = $false
        privatePathsEmitted = $false
        rawEnvironmentDumped = $false
    }
}

$result | ConvertTo-Json -Depth 8 -Compress

