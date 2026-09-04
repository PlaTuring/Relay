[CmdletBinding()]
param(
    [ValidateSet('Host', 'Fixture')]
    [string]$Mode = 'Host',

    [string]$FixtureRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Test-PathSafe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [ValidateSet('Any', 'Container', 'Leaf')]
        [string]$PathType = 'Any'
    )

    try {
        if ($PathType -eq 'Any') {
            return [bool](Test-Path -LiteralPath $LiteralPath -ErrorAction Stop)
        }

        return [bool](Test-Path -LiteralPath $LiteralPath -PathType $PathType -ErrorAction Stop)
    }
    catch {
        return $false
    }
}

function Test-ReparsePoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    if (-not (Test-PathSafe -LiteralPath $LiteralPath)) {
        return $false
    }

    try {
        $item = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
        return [bool](($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
    }
    catch {
        return $false
    }
}

function New-ProbeCandidate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Id,

        [Parameter(Mandatory = $true)]
        [ValidateSet('DesktopExecutable', 'DesktopState', 'DesktopRegistry', 'PortableRoot', 'CoreRoot', 'UnknownRoot')]
        [string]$Kind,

        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$Source,

        [hashtable]$Metadata = @{}
    )

    return [pscustomobject][ordered]@{
        Id       = $Id
        Kind     = $Kind
        Root     = $Root
        Source   = $Source
        Metadata = $Metadata
    }
}

function Add-PathCandidate {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[object]]$Candidates,

        [Parameter(Mandatory = $true)]
        [string]$Id,

        [Parameter(Mandatory = $true)]
        [string]$Kind,

        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$Source
    )

    if ([string]::IsNullOrWhiteSpace($Root)) {
        return
    }

    $Candidates.Add((New-ProbeCandidate -Id $Id -Kind $Kind -Root $Root -Source $Source))
}

function Get-HostCandidates {
    $candidates = New-Object 'System.Collections.Generic.List[object]'

    $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    $roamingAppData = [Environment]::GetEnvironmentVariable('APPDATA')
    $userProfile = [Environment]::GetEnvironmentVariable('USERPROFILE')

    if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
        Add-PathCandidate -Candidates $candidates -Id 'desktop-programfiles' -Kind 'DesktopExecutable' -Root (Join-Path $programFiles 'Comfy Desktop\Comfy Desktop.exe') -Source 'known_path'
    }
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        Add-PathCandidate -Candidates $candidates -Id 'desktop-programfiles-x86' -Kind 'DesktopExecutable' -Root (Join-Path $programFilesX86 'Comfy Desktop\Comfy Desktop.exe') -Source 'known_path'
    }
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        Add-PathCandidate -Candidates $candidates -Id 'desktop-local-programs' -Kind 'DesktopExecutable' -Root (Join-Path $localAppData 'Programs\Comfy Desktop\Comfy Desktop.exe') -Source 'known_path'
        Add-PathCandidate -Candidates $candidates -Id 'desktop-local-data-state' -Kind 'DesktopState' -Root (Join-Path $localAppData 'Comfy-Desktop') -Source 'documented_data_path'
    }
    if (-not [string]::IsNullOrWhiteSpace($roamingAppData)) {
        Add-PathCandidate -Candidates $candidates -Id 'desktop-roaming-state' -Kind 'DesktopState' -Root (Join-Path $roamingAppData 'Comfy Desktop') -Source 'documented_data_path'
    }

    Add-PathCandidate -Candidates $candidates -Id 'portable-d-default' -Kind 'PortableRoot' -Root 'D:\ComfyUI_windows_portable' -Source 'known_path'
    Add-PathCandidate -Candidates $candidates -Id 'core-d-default' -Kind 'CoreRoot' -Root 'D:\ComfyUI' -Source 'known_path'
    Add-PathCandidate -Candidates $candidates -Id 'core-c-default' -Kind 'CoreRoot' -Root 'C:\ComfyUI' -Source 'known_path'
    if (-not [string]::IsNullOrWhiteSpace($userProfile)) {
        Add-PathCandidate -Candidates $candidates -Id 'core-userprofile-default' -Kind 'CoreRoot' -Root (Join-Path $userProfile 'ComfyUI') -Source 'known_path'
        Add-PathCandidate -Candidates $candidates -Id 'desktop-user-installations-state' -Kind 'DesktopState' -Root (Join-Path $userProfile 'ComfyUI-Installs') -Source 'legacy_documented_data_path'
    }

    $uninstallRoots = @(
        [pscustomobject]@{ Id = 'hkcu'; Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
        [pscustomobject]@{ Id = 'hklm64'; Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' },
        [pscustomobject]@{ Id = 'hklm32'; Path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' }
    )

    foreach ($uninstallRoot in $uninstallRoots) {
        $records = @()
        try {
            $records = @(Get-ItemProperty -Path $uninstallRoot.Path -ErrorAction SilentlyContinue | Where-Object {
                    $_.DisplayName -match '^(Comfy Desktop|ComfyUI|ComfyUI Desktop)$'
                })
        }
        catch {
            $records = @()
        }

        $ordinal = 0
        foreach ($record in $records) {
            $ordinal++
            $installLocation = $null
            if ($record.PSObject.Properties.Name -contains 'InstallLocation') {
                $installLocation = [string]$record.InstallLocation
            }

            $displayVersion = $null
            if ($record.PSObject.Properties.Name -contains 'DisplayVersion') {
                $displayVersion = [string]$record.DisplayVersion
            }

            $metadata = @{
                registryRecord = $true
                displayVersion = $displayVersion
            }
            $candidates.Add((New-ProbeCandidate -Id ("desktop-registry-{0}-{1:d2}" -f $uninstallRoot.Id, $ordinal) -Kind 'DesktopRegistry' -Root $installLocation -Source 'windows_uninstall_registry' -Metadata $metadata))
        }
    }

    return $candidates.ToArray()
}

function Get-FixtureCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    if (-not (Test-PathSafe -LiteralPath $Root -PathType Container)) {
        throw 'FixtureRoot must be an existing directory.'
    }
    if (Test-ReparsePoint -LiteralPath $Root) {
        throw 'FixtureRoot cannot be a reparse point.'
    }

    return @(
        (New-ProbeCandidate -Id 'fixture-desktop' -Kind 'DesktopExecutable' -Root (Join-Path $Root 'desktop-managed\Comfy Desktop.exe') -Source 'fixture'),
        (New-ProbeCandidate -Id 'fixture-desktop-state' -Kind 'DesktopState' -Root (Join-Path $Root 'desktop-state-only') -Source 'fixture'),
        (New-ProbeCandidate -Id 'fixture-portable' -Kind 'PortableRoot' -Root (Join-Path $Root 'portable') -Source 'fixture'),
        (New-ProbeCandidate -Id 'fixture-core' -Kind 'CoreRoot' -Root (Join-Path $Root 'core') -Source 'fixture'),
        (New-ProbeCandidate -Id 'fixture-unknown' -Kind 'UnknownRoot' -Root (Join-Path $Root 'unknown') -Source 'fixture')
    )
}

function Test-RelativeMarker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$RelativePath,

        [ValidateSet('Container', 'Leaf')]
        [string]$PathType = 'Leaf'
    )

    $target = Join-Path $Root $RelativePath
    return Test-PathSafe -LiteralPath $target -PathType $PathType
}

function Get-CandidateEvidence {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Candidate
    )

    $markers = [ordered]@{}
    $topology = 'none'
    $state = 'not_found'
    $reason = 'No expected marker was found.'
    $rootPresent = $false
    $rootIsReparsePoint = $false

    if ($Candidate.Kind -eq 'DesktopRegistry') {
        $markers.registryRecord = [bool]$Candidate.Metadata.registryRecord
        $markers.installLocationPresent = -not [string]::IsNullOrWhiteSpace([string]$Candidate.Root)
        $topology = 'desktop_managed_registry_candidate'
        $state = 'evidence_found'
        $reason = 'An exact-name uninstall registry record was found; no private Desktop state was opened.'
    }
    elseif ($Candidate.Kind -eq 'DesktopExecutable') {
        $markers.desktopExecutable = Test-PathSafe -LiteralPath $Candidate.Root -PathType Leaf
        $rootPresent = [bool]$markers.desktopExecutable
        if ($rootPresent) {
            $rootIsReparsePoint = Test-ReparsePoint -LiteralPath $Candidate.Root
        }

        if ($rootIsReparsePoint) {
            $topology = 'blocked_reparse_point'
            $state = 'blocked'
            $reason = 'The executable marker is a reparse point and was not approved.'
        }
        elseif ($markers.desktopExecutable) {
            $topology = 'desktop_managed_candidate'
            $state = 'evidence_found'
            $reason = 'A known executable marker exists; instance compatibility remains unverified.'
        }
    }
    else {
        $rootPresent = Test-PathSafe -LiteralPath $Candidate.Root -PathType Container
        if ($rootPresent) {
            $rootIsReparsePoint = Test-ReparsePoint -LiteralPath $Candidate.Root
        }

        if ($rootIsReparsePoint) {
            $topology = 'blocked_reparse_point'
            $state = 'blocked'
            $reason = 'The candidate root is a reparse point; child markers were not traversed.'
        }
        elseif ($Candidate.Kind -eq 'DesktopState') {
            $markers.stateDirectory = $rootPresent
            if ($rootPresent) {
                $topology = 'desktop_state_only'
                $state = 'evidence_found'
                $reason = 'A documented Desktop data directory exists; this does not prove the launcher is installed.'
            }
        }
        elseif ($Candidate.Kind -eq 'PortableRoot') {
            $markers.comfyMain = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'ComfyUI\main.py'
            $markers.cliArgs = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'ComfyUI\comfy\cli_args.py'
            $markers.embeddedPython = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'python_embeded\python.exe'
            $markers.launcherScript = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'run_nvidia_gpu.bat'

            $foundCount = @($markers.Values | Where-Object { $_ }).Count
            if ($markers.comfyMain -and $markers.cliArgs -and $markers.embeddedPython) {
                $topology = 'portable_candidate'
                $state = 'evidence_found'
                $reason = 'Portable layout markers exist; no embedded Python was started.'
            }
            elseif ($foundCount -gt 0) {
                $topology = 'unknown_partial_layout'
                $state = 'partial'
                $reason = 'Some portable markers exist, but the layout is incomplete.'
            }
        }
        elseif ($Candidate.Kind -eq 'CoreRoot') {
            $markers.comfyMain = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'main.py'
            $markers.cliArgs = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'comfy\cli_args.py'
            $markers.gitMetadata = Test-RelativeMarker -Root $Candidate.Root -RelativePath '.git' -PathType Container
            $markers.modelsDirectory = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'models' -PathType Container

            $foundCount = @($markers.Values | Where-Object { $_ }).Count
            if ($markers.comfyMain -and $markers.cliArgs) {
                $topology = 'core_candidate'
                $state = 'evidence_found'
                $reason = 'Core layout markers exist; no Python or git command was run.'
            }
            elseif ($foundCount -gt 0) {
                $topology = 'unknown_partial_layout'
                $state = 'partial'
                $reason = 'Some Core markers exist, but the layout is incomplete.'
            }
        }
        else {
            $markers.mainPy = Test-RelativeMarker -Root $Candidate.Root -RelativePath 'main.py'
            if ($markers.mainPy) {
                $topology = 'unknown_partial_layout'
                $state = 'partial'
                $reason = 'A generic main.py exists without enough Comfy markers.'
            }
        }
    }

    $displayVersion = $null
    if ($Candidate.Metadata.ContainsKey('displayVersion') -and -not [string]::IsNullOrWhiteSpace([string]$Candidate.Metadata.displayVersion)) {
        $displayVersion = [string]$Candidate.Metadata.displayVersion
    }

    return [pscustomobject][ordered]@{
        candidateId        = $Candidate.Id
        source             = $Candidate.Source
        topology           = $topology
        discoveryState     = $state
        staticEvidenceOnly = $true
        rootPresent        = $rootPresent
        rootIsReparsePoint = $rootIsReparsePoint
        displayVersion     = $displayVersion
        markers            = [pscustomobject]$markers
        reason             = $reason
        pathDisclosure     = 'redacted'
    }
}

if ($Mode -eq 'Fixture') {
    if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
        throw 'Fixture mode requires -FixtureRoot.'
    }
    $candidates = Get-FixtureCandidates -Root $FixtureRoot
}
else {
    $candidates = Get-HostCandidates
}

$evidence = @($candidates | ForEach-Object { Get-CandidateEvidence -Candidate $_ })
$summary = [ordered]@{
    candidateChecks                = $evidence.Count
    evidenceFound                  = @($evidence | Where-Object { $_.discoveryState -eq 'evidence_found' }).Count
    partialLayouts                 = @($evidence | Where-Object { $_.discoveryState -eq 'partial' }).Count
    blockedReparsePoints           = @($evidence | Where-Object { $_.discoveryState -eq 'blocked' }).Count
    desktopExecutableCandidates    = @($evidence | Where-Object { $_.topology -eq 'desktop_managed_candidate' }).Count
    desktopRegistryCandidates      = @($evidence | Where-Object { $_.topology -eq 'desktop_managed_registry_candidate' }).Count
    desktopStateOnlyCandidates     = @($evidence | Where-Object { $_.topology -eq 'desktop_state_only' }).Count
    portableCandidates             = @($evidence | Where-Object { $_.topology -eq 'portable_candidate' }).Count
    coreCandidates                 = @($evidence | Where-Object { $_.topology -eq 'core_candidate' }).Count
}

$result = [pscustomobject][ordered]@{
    schemaVersion = 'runtime-probe-spike/0.1'
    taskId        = 'P0-ARC-001'
    mode          = $Mode.ToLowerInvariant()
    safety        = [pscustomobject][ordered]@{
        readOnly                = $true
        executesExternalProcess = $false
        importsExternalPython   = $false
        installsSoftware        = $false
        readsDesktopPrivateState = $false
        revealsAbsolutePaths    = $false
    }
    summary       = [pscustomobject]$summary
    candidates    = $evidence
    limitations   = @(
        'Static marker discovery does not prove compatibility, trust, model identity, launchability, or OPEN_AND_FOCUS.',
        'Desktop data-directory presence is reported separately from executable or registry evidence.',
        'Model directories are not enumerated and large files are not hashed.',
        'Reparse-point roots are not traversed.'
    )
}

$result | ConvertTo-Json -Depth 8
