[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$testDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$tasksDirectory = Split-Path -Parent $testDirectory
$validatorPath = Join-Path $tasksDirectory 'validate_wbs.ps1'
$tempName = 'minimaxh3-wbs-tests-' + [guid]::NewGuid().ToString('N')
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) $tempName
$wbsPath = Join-Path $tempRoot 'TASK_BREAKDOWN.md'
$registryPath = Join-Path $tempRoot 'registry.json'

$script:Passed = 0
$script:Failures = [System.Collections.Generic.List[string]]::new()

$script:LegalWbs = @'
# Validator fixture WBS

> Baseline: 15 bounded tasks.

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P0-GOV-001 | Root |  | root | root | CPU / 1 |
| P0-CON-001 | Accepted schema | P0-GOV-001 | schema | schema | SCHEMA / 1 |
| P0-CON-002 | Ready schema | P0-GOV-001 | schema | schema | SCHEMA / 1 |
| P1-CPU-001 | Worker one | P0-CON-001 | one | one | CPU / 1 |
| P1-CPU-002 | Worker two | P0-GOV-001 | two | two | CPU / 1 |
| P1-CPU-003 | Worker three | P0-GOV-001 | three | three | CPU / 1 |
| P1-CPU-004 | Gated worker | P0-GOV-001 | four | four | CPU / 1 |
| P1-CPU-005 | Worker five | P0-GOV-001 | five | five | CPU / 1 |
| P1-CPU-006 | Worker six | P0-GOV-001 | six | six | CPU / 1 |
| P1-CPU-007 | Worker seven | P0-GOV-001 | seven | seven | CPU / 1 |
| P1-CPU-008 | Worker eight | P0-GOV-001 | eight | eight | CPU / 1 |
| P1-CPU-009 | Worker nine | P0-GOV-001 | nine | nine | CPU / 1 |
| P1-CPU-010 | Worker ten | P0-GOV-001 | ten | ten | CPU / 1 |
| P1-CPU-011 | Worker eleven | P0-GOV-001 | eleven | eleven | CPU / 1 |
| P2-REL-001 | External release | P1-CPU-001,EXT-BRAND-ASSET | release | release | CPU / 1 |
'@

function New-LegalRegistry {
    return [pscustomobject]@{
        schema_version = 'test-1.0.0'
        master_agent = '/root'
        full_catalog = [pscustomobject]@{
            path = 'TASK_BREAKDOWN.md'
            task_count = 15
        }
        status_values = @(
            'backlog',
            'ready',
            'assigned',
            'in_progress',
            'review',
            'changes_requested',
            'accepted',
            'blocked_external',
            'rejected_scope'
        )
        resource_locks = [pscustomobject]@{
            SCHEMA = $null
            'ROOT-LOCKFILE' = $null
            'MODEL-DOWNLOAD' = $null
            'GPU-H3' = $null
            'COMFY-DESKTOP' = $null
            'WIN-VM' = $null
        }
        external_gates = @(
            [pscustomobject]@{
                id = 'EXT-BRAND-ASSET'
                status = 'blocked_external'
                owner = 'release-owner'
                satisfies = 'Synthetic test-only external requirement.'
            }
        )
        gates = @(
            [pscustomobject]@{
                id = 'G0'
                name = 'scope'
                status = 'accepted'
                requires = @('P0-GOV-001')
                unlocks = @(
                    'P0-CON-001',
                    'P0-CON-002',
                    'P1-CPU-001',
                    'P1-CPU-002',
                    'P1-CPU-003',
                    'P1-CPU-005',
                    'P1-CPU-006',
                    'P1-CPU-007',
                    'P1-CPU-008',
                    'P1-CPU-009',
                    'P1-CPU-010',
                    'P1-CPU-011'
                )
            },
            [pscustomobject]@{
                id = 'G1'
                name = 'contracts'
                status = 'not_started'
                requires = @('P0-CON-002')
                unlocks = @('P1-CPU-004', 'P2-REL-001')
            }
        )
        tasks = @(
            [pscustomobject]@{
                id = 'P0-GOV-001'; status = 'accepted'; owner = '/root'
                depends_on = @(); allowed_paths = @('AGENTS.md'); locks = @()
            },
            [pscustomobject]@{
                id = 'P0-CON-001'; status = 'accepted'; owner = '/root/history'
                depends_on = @('P0-GOV-001'); allowed_paths = @('schemas/accepted/**'); locks = @('SCHEMA')
            },
            [pscustomobject]@{
                id = 'P0-CON-002'; status = 'ready'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('schemas/ready/**'); locks = @('SCHEMA')
            },
            [pscustomobject]@{
                id = 'P1-CPU-001'; status = 'in_progress'; owner = '/root/worker-1'
                depends_on = @('P0-CON-001'); allowed_paths = @('src/worker-1/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-002'; status = 'in_progress'; owner = '/root/worker-2'
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-2/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-003'; status = 'in_progress'; owner = '/root/worker-3'
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-3/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-004'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-4/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-005'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-5/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-006'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-6/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-007'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-7/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-008'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-8/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-009'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-9/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-010'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-10/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P1-CPU-011'; status = 'backlog'; owner = $null
                depends_on = @('P0-GOV-001'); allowed_paths = @('src/worker-11/**'); locks = @()
            },
            [pscustomobject]@{
                id = 'P2-REL-001'; status = 'backlog'; owner = $null
                depends_on = @('P1-CPU-001'); allowed_paths = @('release/**'); locks = @()
            }
        )
        current_wave = [pscustomobject]@{
            id = 'test-wave'
            status = 'in_progress'
            tasks = @('P1-CPU-001', 'P1-CPU-002', 'P1-CPU-003')
            next_ready = @('P0-CON-002')
        }
    }
}

function Write-Fixture {
    param(
        [Parameter(Mandatory)]$Registry,
        [Parameter(Mandatory)][string]$WbsText
    )

    Set-Content -LiteralPath $wbsPath -Value $WbsText -Encoding UTF8
    $Registry | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $registryPath -Encoding UTF8
}

function Invoke-Fixture {
    param(
        [Parameter(Mandatory)]$Registry,
        [string]$WbsText = $script:LegalWbs
    )

    Write-Fixture -Registry $Registry -WbsText $WbsText
    try {
        $output = @(
            & $validatorPath -TaskBreakdownPath $wbsPath -RegistryPath $registryPath 2>&1
        )
        return [pscustomobject]@{
            passed = $true
            text = $output -join "`n"
        }
    }
    catch {
        return [pscustomobject]@{
            passed = $false
            text = [string]$_.Exception.Message
        }
    }
}

function Assert-Pass {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)]$Registry,
        [string]$WbsText = $script:LegalWbs,
        [string]$ExpectedText = 'WBS_VALIDATION_OK'
    )

    $result = Invoke-Fixture -Registry $Registry -WbsText $WbsText
    if (-not $result.passed -or $result.text -notmatch [regex]::Escape($ExpectedText)) {
        $script:Failures.Add("$Name expected pass containing '$ExpectedText'; actual: $($result.text)")
        return
    }
    $script:Passed++
    Write-Output "PASS $Name"
}

function Assert-Fail {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)]$Registry,
        [Parameter(Mandatory)][string]$ExpectedText,
        [string]$WbsText = $script:LegalWbs
    )

    $result = Invoke-Fixture -Registry $Registry -WbsText $WbsText
    if ($result.passed -or $result.text -notmatch [regex]::Escape($ExpectedText)) {
        $script:Failures.Add("$Name expected failure containing '$ExpectedText'; actual: $($result.text)")
        return
    }
    $script:Passed++
    Write-Output "PASS $Name"
}

function Disable-DefaultWorkers {
    param([Parameter(Mandatory)]$Registry)

    foreach ($id in @('P1-CPU-001', 'P1-CPU-002', 'P1-CPU-003')) {
        $task = $Registry.tasks | Where-Object { $_.id -eq $id }
        $task.status = 'backlog'
        $task.owner = $null
    }
}

New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
try {
    Assert-Pass -Name 'legal-fixture' -Registry (New-LegalRegistry) -ExpectedText 'external=1'

    $case = New-LegalRegistry
    $case.master_agent = '/root/not-master'
    Assert-Fail -Name 'wrong-master' -Registry $case -ExpectedText 'master_agent must be exactly /root'

    Assert-Pass -Name 'three-workers' -Registry (New-LegalRegistry) -ExpectedText 'wave=3'

    $case = New-LegalRegistry
    $fourth = $case.tasks | Where-Object { $_.id -eq 'P1-CPU-004' }
    $fourth.status = 'in_progress'
    $fourth.owner = '/root/worker-4'
    $readySchema = $case.tasks | Where-Object { $_.id -eq 'P0-CON-002' }
    $readySchema.status = 'accepted'
    $readySchema.owner = '/root/history'
    $case.gates | Where-Object { $_.id -eq 'G1' } | ForEach-Object { $_.status = 'accepted' }
    $case.current_wave.tasks = @($case.current_wave.tasks) + $fourth.id
    $case.current_wave.next_ready = @()
    Assert-Fail -Name 'four-workers' -Registry $case -ExpectedText 'exceeds the three-worker limit'

    $case = New-LegalRegistry
    $dependency = $case.tasks | Where-Object { $_.id -eq 'P0-CON-001' }
    $dependency.status = 'backlog'
    $dependency.owner = $null
    Assert-Fail -Name 'dependency-not-accepted' -Registry $case -ExpectedText 'requires an accepted registry dependency: P0-CON-001'

    $case = New-LegalRegistry
    Disable-DefaultWorkers -Registry $case
    $lockedTask = $case.tasks | Where-Object { $_.id -eq 'P0-CON-002' }
    $lockedTask.status = 'in_progress'
    $lockedTask.owner = '/root/worker-1'
    $case.current_wave.tasks = @('P0-CON-002')
    $case.current_wave.next_ready = @()
    Assert-Fail -Name 'lock-null' -Registry $case -ExpectedText 'lock SCHEMA, but the lock holder is null'

    $case = New-LegalRegistry
    Disable-DefaultWorkers -Registry $case
    $lockedTask = $case.tasks | Where-Object { $_.id -eq 'P0-CON-002' }
    $lockedTask.status = 'in_progress'
    $lockedTask.owner = '/root/worker-1'
    $case.current_wave.tasks = @('P0-CON-002')
    $case.current_wave.next_ready = @()
    $case.resource_locks.SCHEMA = '/root/worker-2'
    Assert-Fail -Name 'lock-wrong-holder' -Registry $case -ExpectedText 'held by its exact owner /root/worker-1, not /root/worker-2'

    $case = New-LegalRegistry
    $case.tasks = @($case.tasks | Where-Object { $_.id -ne 'P1-CPU-004' })
    $case.current_wave.next_ready = @('P1-CPU-004')
    Assert-Fail -Name 'next-ready-not-materialized' -Registry $case -ExpectedText 'must be materialized in the registry: P1-CPU-004'

    $case = New-LegalRegistry
    $gatedTask = $case.tasks | Where-Object { $_.id -eq 'P1-CPU-004' }
    $gatedTask.status = 'ready'
    $gatedTask.owner = $null
    $case.current_wave.next_ready = @('P1-CPU-004')
    Assert-Fail -Name 'gate-not-accepted' -Registry $case -ExpectedText 'cannot be ready while gate G1 is not accepted'

    $case = New-LegalRegistry
    $case.tasks | Where-Object { $_.id -eq 'P1-CPU-002' } | ForEach-Object {
        $_.allowed_paths = @('src/worker-1/child/**')
    }
    Assert-Fail -Name 'allowed-path-parent-child-conflict' -Registry $case -ExpectedText 'allowed_paths overlap or cannot be proven disjoint'

    $case = New-LegalRegistry
    $case.gates | Where-Object { $_.id -eq 'G1' } | ForEach-Object { $_.status = 'accepted' }
    Assert-Fail -Name 'accepted-gate-requirement-not-accepted' -Registry $case -ExpectedText 'Accepted gate G1 requires an accepted registry task: P0-CON-002'

    $case = New-LegalRegistry
    Disable-DefaultWorkers -Registry $case
    $case.current_wave.tasks = @()
    $case.current_wave.status = 'in_progress'
    Assert-Fail -Name 'empty-wave-status-closure' -Registry $case -ExpectedText 'empty current wave must have status=accepted'

    $case = New-LegalRegistry
    Disable-DefaultWorkers -Registry $case
    foreach ($id in @('P0-CON-001', 'P0-CON-002')) {
        $task = $case.tasks | Where-Object { $_.id -eq $id }
        $task.status = 'in_progress'
        $task.owner = '/root/worker-1'
    }
    $case.current_wave.tasks = @('P0-CON-001', 'P0-CON-002')
    $case.current_wave.next_ready = @()
    $case.resource_locks.SCHEMA = '/root/worker-1'
    Assert-Fail -Name 'exclusive-lock-shared' -Registry $case -ExpectedText 'Exclusive lock SCHEMA is required by multiple active tasks'

    $case = New-LegalRegistry
    $oldExternalWbs = $script:LegalWbs.Replace('EXT-BRAND-ASSET', 'external brand asset')
    Assert-Fail -Name 'legacy-external-token-rejected' -Registry $case -WbsText $oldExternalWbs -ExpectedText 'must be one machine-readable EXT-* token'

    $case = New-LegalRegistry
    $unknownExternalWbs = $script:LegalWbs.Replace('EXT-BRAND-ASSET', 'EXT-UNREGISTERED-ASSET')
    Assert-Fail -Name 'unregistered-external-gate-rejected' -Registry $case -WbsText $unknownExternalWbs -ExpectedText 'references an unregistered external gate: EXT-UNREGISTERED-ASSET'

    $case = New-LegalRegistry
    ($case.gates | Where-Object { $_.id -eq 'G1' }).name = 'scope'
    Assert-Fail -Name 'duplicate-gate-name-rejected' -Registry $case -ExpectedText 'gate names must be non-empty and unique: scope'
}
finally {
    $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
    $resolvedTempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedLeaf = [System.IO.Path]::GetFileName($resolvedTemp)
    if (
        -not $resolvedTemp.StartsWith($resolvedTempParent, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $resolvedLeaf.StartsWith('minimaxh3-wbs-tests-', [System.StringComparison]::Ordinal)
    ) {
        throw "Refusing to clean an unexpected test directory."
    }
    if (Test-Path -LiteralPath $resolvedTemp) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}

if ($script:Failures.Count -gt 0) {
    foreach ($failure in $script:Failures) {
        Write-Error $failure
    }
    throw "WBS validator tests failed: $($script:Failures.Count)"
}

Write-Output "SUMMARY passed=$($script:Passed) failed=0"
