[CmdletBinding()]
param(
    [string]$TaskBreakdownPath,
    [string]$RegistryPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($TaskBreakdownPath)) {
    $TaskBreakdownPath = Join-Path $scriptDirectory 'TASK_BREAKDOWN.md'
}
if ([string]::IsNullOrWhiteSpace($RegistryPath)) {
    $RegistryPath = Join-Path $scriptDirectory 'registry.json'
}

$allowedStatuses = @(
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
$ownedStatuses = @('assigned', 'in_progress', 'review', 'changes_requested', 'accepted')
$allowedLocks = @('SCHEMA', 'ROOT-LOCKFILE', 'MODEL-DOWNLOAD', 'GPU-H3', 'COMFY-DESKTOP', 'WIN-VM')
$activeStatuses = @('assigned', 'in_progress', 'review', 'changes_requested')
$readyOrActiveStatuses = @('ready') + $activeStatuses
$externalPrerequisites = [System.Collections.Generic.List[object]]::new()

function Expand-DependencyToken {
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$TaskId
    )

    $trimmed = $Token.Trim()
    if ($trimmed -match '^(.+-)(\d{3})\.\.(?:.+-)?(\d{3})$') {
        $prefix = $Matches[1]
        $start = [int]$Matches[2]
        $end = [int]$Matches[3]
        if ($end -lt $start) {
            throw "Descending dependency range is forbidden: $trimmed"
        }
        return @($start..$end | ForEach-Object { '{0}{1:D3}' -f $prefix, $_ })
    }

    $looksExternal = (
        $trimmed -eq 'remote-update program' -or
        $trimmed -match '^external(?:\s|$)' -or
        $trimmed -match '^EXT-'
    )
    if ($looksExternal) {
        $externalMatch = [regex]::Match(
            $trimmed,
            '^(?:external\s+)?(EXT-[A-Z0-9]+(?:-[A-Z0-9]+)*)$'
        )
        if (-not $externalMatch.Success) {
            throw (
                "External prerequisite for $TaskId must be one machine-readable " +
                "EXT-* token (for example: external EXT-BRAND-ASSET): $trimmed"
            )
        }
        $externalPrerequisites.Add([pscustomobject]@{
            task_id = $TaskId
            token = $externalMatch.Groups[1].Value
        })
        return @()
    }

    return @($trimmed)
}

if (-not (Test-Path -LiteralPath $TaskBreakdownPath -PathType Leaf)) {
    throw "Task catalog not found: $TaskBreakdownPath"
}
if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) {
    throw "Active registry not found: $RegistryPath"
}

$catalogText = Get-Content -LiteralPath $TaskBreakdownPath -Raw -Encoding UTF8
$declaredCountMatch = [regex]::Match($catalogText, 'Baseline:\s*(\d+)\s+bounded tasks')
if (-not $declaredCountMatch.Success) {
    throw 'The WBS baseline task count is missing.'
}
$declaredCount = [int]$declaredCountMatch.Groups[1].Value

$rows = @(
    Get-Content -LiteralPath $TaskBreakdownPath -Encoding UTF8 |
        Where-Object { $_ -match '^\|\s*([A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3})\s*\|' }
)
$taskMap = [ordered]@{}
$taskQueueMap = [ordered]@{}
$duplicateIds = [System.Collections.Generic.List[string]]::new()

foreach ($row in $rows) {
    $columns = $row.Split('|')
    $taskId = $columns[1].Trim()
    $dependencyCell = $columns[3].Trim()
    if ($taskMap.Contains($taskId)) {
        $duplicateIds.Add($taskId)
        continue
    }

    $dependencies = [System.Collections.Generic.List[string]]::new()
    if (
        -not [string]::IsNullOrWhiteSpace($dependencyCell) -and
        $dependencyCell -ne [string][char]0x2014
    ) {
        foreach ($token in $dependencyCell.Split(',')) {
            foreach ($dependency in (Expand-DependencyToken -Token $token -TaskId $taskId)) {
                if ($dependency) {
                    $dependencies.Add($dependency)
                }
            }
        }
    }
    $taskMap[$taskId] = @($dependencies)
    $taskQueueMap[$taskId] = $columns[6].Trim()
}

if ($duplicateIds.Count -gt 0) {
    throw "Duplicate WBS task IDs: $($duplicateIds -join ', ')"
}
if ($taskMap.Count -ne $declaredCount) {
    throw "WBS count mismatch: declared=$declaredCount parsed=$($taskMap.Count)"
}

$missingDependencies = [System.Collections.Generic.List[string]]::new()
foreach ($taskId in $taskMap.Keys) {
    foreach ($dependency in $taskMap[$taskId]) {
        if (-not $taskMap.Contains($dependency)) {
            $missingDependencies.Add("$taskId->$dependency")
        }
    }
}
if ($missingDependencies.Count -gt 0) {
    throw "Missing WBS dependencies: $($missingDependencies -join ', ')"
}

$visitState = @{}
$visitTrail = [System.Collections.Generic.List[string]]::new()
$cycles = [System.Collections.Generic.List[string]]::new()

function Visit-Task {
    param([Parameter(Mandatory)][string]$TaskId)

    if ($visitState[$TaskId] -eq 1) {
        $cycleText = (@($visitTrail) + $TaskId) -join ' -> '
        $cycles.Add($cycleText)
        return
    }
    if ($visitState[$TaskId] -eq 2) {
        return
    }

    $visitState[$TaskId] = 1
    $visitTrail.Add($TaskId)
    foreach ($dependency in $taskMap[$TaskId]) {
        Visit-Task -TaskId $dependency
    }
    $visitTrail.RemoveAt($visitTrail.Count - 1)
    $visitState[$TaskId] = 2
}

foreach ($taskId in $taskMap.Keys) {
    Visit-Task -TaskId $taskId
}
if ($cycles.Count -gt 0) {
    throw "WBS dependency cycles: $($cycles -join ' | ')"
}

function Assert-UniqueIds {
    param(
        [AllowEmptyCollection()][object[]]$Values,
        [Parameter(Mandatory)][string]$Label
    )

    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($value in @($Values)) {
        $id = [string]$value
        if ([string]::IsNullOrWhiteSpace($id)) {
            throw "$Label contains an empty ID."
        }
        if (-not $seen.Add($id)) {
            throw "$Label contains a duplicate ID: $id"
        }
    }
}

function ConvertTo-ConservativeAllowedPath {
    param(
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$TaskId
    )

    $normalized = $Pattern.Trim().Replace('\', '/')
    while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(2)
    }
    $normalized = $normalized.TrimEnd('/')

    if (
        [string]::IsNullOrWhiteSpace($normalized) -or
        [System.IO.Path]::IsPathRooted($normalized) -or
        $normalized -match '^[A-Za-z]:'
    ) {
        throw "Current-wave task $TaskId has a non-relative or empty allowed_path: $Pattern"
    }

    $isSubtree = $normalized.EndsWith('/**', [System.StringComparison]::Ordinal)
    $basePath = if ($isSubtree) {
        $normalized.Substring(0, $normalized.Length - 3).TrimEnd('/')
    }
    else {
        $normalized
    }

    if (
        [string]::IsNullOrWhiteSpace($basePath) -or
        $basePath.IndexOfAny([char[]]'*?[') -ge 0 -or
        @($basePath.Split('/') | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0
    ) {
        throw (
            "Current-wave task $TaskId has an allowed_path whose non-overlap " +
            "cannot be proven: $Pattern"
        )
    }

    return [pscustomobject]@{
        task_id = $TaskId
        original = $Pattern
        base = $basePath.ToLowerInvariant()
        subtree = $isSubtree
    }
}

function Test-ConservativePathOverlap {
    param(
        [Parameter(Mandatory)]$Left,
        [Parameter(Mandatory)]$Right
    )

    if ($Left.base -eq $Right.base) {
        return $true
    }
    if ($Left.base.StartsWith($Right.base + '/', [System.StringComparison]::Ordinal)) {
        return $true
    }
    if ($Right.base.StartsWith($Left.base + '/', [System.StringComparison]::Ordinal)) {
        return $true
    }
    return $false
}

$registry = Get-Content -LiteralPath $RegistryPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$registry.master_agent -cne '/root') {
    throw "Registry master_agent must be exactly /root: $($registry.master_agent)"
}
if ($registry.full_catalog.task_count -ne $taskMap.Count) {
    throw "Registry catalog count mismatch: registry=$($registry.full_catalog.task_count) WBS=$($taskMap.Count)"
}
if ((@($registry.status_values) -join '|') -ne ($allowedStatuses -join '|')) {
    throw 'Registry status_values do not match the validated status contract.'
}

$externalGateIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$externalGateMap = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
if ($null -eq $registry.PSObject.Properties['external_gates']) {
    throw 'Registry external_gates is required, even when the list is empty.'
}
foreach ($externalGate in @($registry.external_gates)) {
    $externalId = [string]$externalGate.id
    if (
        $externalId -notmatch '^EXT-[A-Z0-9]+(?:-[A-Z0-9]+)*$' -or
        -not $externalGateIds.Add($externalId)
    ) {
        throw "Registry external gate IDs must be unique machine-readable EXT-* tokens: $externalId"
    }
    if (@('accepted', 'blocked_external') -notcontains [string]$externalGate.status) {
        throw "External gate $externalId has invalid status: $($externalGate.status)"
    }
    if ([string]::IsNullOrWhiteSpace([string]$externalGate.owner)) {
        throw "External gate $externalId requires a non-empty Human/external owner."
    }
    $externalGateMap.Add($externalId, $externalGate)
}

$registryIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$registryTaskMap = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
foreach ($task in $registry.tasks) {
    if (-not $registryIds.Add($task.id)) {
        throw "Duplicate active registry task ID: $($task.id)"
    }
    $registryTaskMap.Add([string]$task.id, $task)
    if (-not $taskMap.Contains($task.id)) {
        throw "Active registry task is absent from WBS: $($task.id)"
    }
    if ($allowedStatuses -notcontains $task.status) {
        throw "Invalid task status $($task.id): $($task.status)"
    }
    if ($ownedStatuses -contains $task.status -and [string]::IsNullOrWhiteSpace([string]$task.owner)) {
        throw "Task status requires an owner: $($task.id)=$($task.status)"
    }
    foreach ($dependency in @($task.depends_on)) {
        if (-not $taskMap.Contains($dependency)) {
            throw "Registry dependency is absent from WBS: $($task.id)->$dependency"
        }
    }

    $catalogDependencies = @($taskMap[$task.id] | Sort-Object -Unique)
    $registryDependencies = @($task.depends_on | Sort-Object -Unique)
    if (($catalogDependencies -join '|') -ne ($registryDependencies -join '|')) {
        throw (
            "Registry dependencies drift from WBS for $($task.id): " +
            "registry=[$($registryDependencies -join ',')] " +
            "WBS=[$($catalogDependencies -join ',')]"
        )
    }

    $queueToLock = @{
        'SCHEMA'   = 'SCHEMA'
        'LOCKFILE' = 'ROOT-LOCKFILE'
        'DL'       = 'MODEL-DOWNLOAD'
        'GPU'      = 'GPU-H3'
        'DESKTOP'  = 'COMFY-DESKTOP'
        'VM'       = 'WIN-VM'
    }
    $expectedLocks = [System.Collections.Generic.List[string]]::new()
    $queuePrefix = ([string]$taskQueueMap[$task.id]).Split('/')[0].Trim()
    foreach ($queueToken in $queuePrefix.Split('+')) {
        $normalizedQueueToken = $queueToken.Trim()
        if ($queueToLock.ContainsKey($normalizedQueueToken)) {
            $expectedLocks.Add($queueToLock[$normalizedQueueToken])
        }
    }
    $expectedTaskLocks = @($expectedLocks | Sort-Object -Unique)
    $actualTaskLocks = @($task.locks | Sort-Object -Unique)
    if (($expectedTaskLocks -join '|') -ne ($actualTaskLocks -join '|')) {
        throw (
            "Registry locks drift from WBS for $($task.id): " +
            "registry=[$($actualTaskLocks -join ',')] " +
            "WBS=[$($expectedTaskLocks -join ',')]"
        )
    }

    foreach ($lock in @($task.locks)) {
        if ($allowedLocks -notcontains $lock) {
            throw "Unknown resource lock on $($task.id): $lock"
        }
    }
}

foreach ($externalPrerequisite in $externalPrerequisites) {
    $externalId = [string]$externalPrerequisite.token
    if (-not $externalGateMap.ContainsKey($externalId)) {
        throw "WBS task $($externalPrerequisite.task_id) references an unregistered external gate: $externalId"
    }
    if ($registryTaskMap.ContainsKey([string]$externalPrerequisite.task_id)) {
        $taskStatus = [string]$registryTaskMap[[string]$externalPrerequisite.task_id].status
        if (
            $readyOrActiveStatuses -contains $taskStatus -and
            [string]$externalGateMap[$externalId].status -ne 'accepted'
        ) {
            throw (
                "Task $($externalPrerequisite.task_id) cannot be $taskStatus while external gate " +
                "$externalId is not accepted."
            )
        }
    }
}

$resourceLockNames = @($registry.resource_locks.PSObject.Properties.Name)
if ((($resourceLockNames | Sort-Object) -join '|') -ne (($allowedLocks | Sort-Object) -join '|')) {
    throw 'Registry resource_locks do not match the validated lock contract.'
}

$gateIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$gateNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($gate in $registry.gates) {
    if ([string]::IsNullOrWhiteSpace([string]$gate.id) -or -not $gateIds.Add([string]$gate.id)) {
        throw "Registry gate IDs must be non-empty and unique: $($gate.id)"
    }
    if ([string]::IsNullOrWhiteSpace([string]$gate.name) -or -not $gateNames.Add([string]$gate.name)) {
        throw "Registry gate names must be non-empty and unique: $($gate.name)"
    }
    if (@('not_started', 'accepted', 'blocked_external') -notcontains [string]$gate.status) {
        throw "Registry gate $($gate.id) has invalid status: $($gate.status)"
    }
    Assert-UniqueIds -Values @($gate.requires) -Label "Gate $($gate.id) requires"
    Assert-UniqueIds -Values @($gate.unlocks) -Label "Gate $($gate.id) unlocks"
    foreach ($taskId in @($gate.requires) + @($gate.unlocks)) {
        if (-not $taskMap.Contains($taskId)) {
            throw "Gate $($gate.id) references a task absent from WBS: $taskId"
        }
    }

    if ([string]$gate.status -eq 'accepted') {
        foreach ($requiredTaskId in @($gate.requires)) {
            if (
                -not $registryTaskMap.ContainsKey([string]$requiredTaskId) -or
                [string]$registryTaskMap[[string]$requiredTaskId].status -ne 'accepted'
            ) {
                throw "Accepted gate $($gate.id) requires an accepted registry task: $requiredTaskId"
            }
        }
    }
    else {
        foreach ($unlockedTaskId in @($gate.unlocks)) {
            if ($registryTaskMap.ContainsKey([string]$unlockedTaskId)) {
                $unlockedStatus = [string]$registryTaskMap[[string]$unlockedTaskId].status
                if ($readyOrActiveStatuses -contains $unlockedStatus) {
                    throw (
                        "Task $unlockedTaskId cannot be $unlockedStatus while gate " +
                        "$($gate.id) is not accepted."
                    )
                }
            }
        }
    }
}

$waveTaskIds = @($registry.current_wave.tasks)
$nextReadyIds = @($registry.current_wave.next_ready)
Assert-UniqueIds -Values $waveTaskIds -Label 'current_wave.tasks'
Assert-UniqueIds -Values $nextReadyIds -Label 'current_wave.next_ready'

if ($waveTaskIds.Count -gt 3) {
    throw "Current wave exceeds the three-worker limit: $($waveTaskIds.Count)"
}
if ($waveTaskIds.Count -eq 0 -and [string]$registry.current_wave.status -ne 'accepted') {
    throw "An empty current wave must have status=accepted: $($registry.current_wave.status)"
}
if ($waveTaskIds.Count -gt 0 -and [string]$registry.current_wave.status -ne 'in_progress') {
    throw "A non-empty current wave must have status=in_progress: $($registry.current_wave.status)"
}

$waveTaskEntries = [System.Collections.Generic.List[object]]::new()
foreach ($taskId in $waveTaskIds) {
    if (-not $registryTaskMap.ContainsKey([string]$taskId)) {
        throw "Current-wave task must have exactly one active registry entry: $taskId"
    }
    $activeTask = $registryTaskMap[[string]$taskId]
    if ($activeStatuses -notcontains [string]$activeTask.status) {
        throw "Current-wave task has a non-active status: $taskId=$($activeTask.status)"
    }
    $waveTaskEntries.Add($activeTask)
}

foreach ($task in @($registry.tasks | Where-Object { $activeStatuses -contains [string]$_.status })) {
    if ($waveTaskIds -notcontains [string]$task.id) {
        throw "Active registry task is absent from current_wave.tasks: $($task.id)"
    }
}

$nonRootOwners = @(
    $waveTaskEntries |
        ForEach-Object { [string]$_.owner } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -cne '/root' } |
        Sort-Object -Unique
)
if ($nonRootOwners.Count -gt 3) {
    throw "Current wave exceeds the three non-root-owner limit: $($nonRootOwners.Count)"
}

foreach ($taskId in $nextReadyIds) {
    if ($waveTaskIds -contains $taskId) {
        throw "Task cannot be both current-wave and next-ready: $taskId"
    }
    if (-not $registryTaskMap.ContainsKey([string]$taskId)) {
        throw "Next-ready task must be materialized in the registry: $taskId"
    }
    $readyTask = $registryTaskMap[[string]$taskId]
    if ([string]$readyTask.status -ne 'ready') {
        throw "Next-ready task must have status=ready: $taskId=$($readyTask.status)"
    }
    if ($null -ne $readyTask.owner) {
        throw "Next-ready task must have owner=null: $taskId"
    }
}

foreach ($task in @($registry.tasks | Where-Object { $readyOrActiveStatuses -contains [string]$_.status })) {
    foreach ($dependency in @($task.depends_on)) {
        if (
            -not $registryTaskMap.ContainsKey([string]$dependency) -or
            [string]$registryTaskMap[[string]$dependency].status -ne 'accepted'
        ) {
            throw (
                "Ready/active task $($task.id) requires an accepted registry " +
                "dependency: $dependency"
            )
        }
    }
}

foreach ($task in $waveTaskEntries) {
    foreach ($lock in @($task.locks)) {
        $holder = [string]$registry.resource_locks.PSObject.Properties[$lock].Value
        if ([string]::IsNullOrWhiteSpace($holder)) {
            throw "Active task $($task.id) requires lock $lock, but the lock holder is null."
        }
        if ($holder -cne [string]$task.owner) {
            throw (
                "Active task $($task.id) requires lock $lock held by its exact owner " +
                "$($task.owner), not $holder."
            )
        }
    }
}

foreach ($lock in $allowedLocks) {
    $holder = [string]$registry.resource_locks.PSObject.Properties[$lock].Value
    $lockTasks = @($waveTaskEntries | Where-Object { @($_.locks) -contains $lock })
    if ($lockTasks.Count -gt 1) {
        throw "Exclusive lock $lock is required by multiple active tasks: $($lockTasks.id -join ', ')"
    }
    if (-not [string]::IsNullOrWhiteSpace($holder)) {
        $matchingTasks = @(
            $lockTasks |
                Where-Object { [string]$_.owner -ceq $holder }
        )
        if ($matchingTasks.Count -ne 1) {
            throw (
                "Non-empty lock holder $lock=$holder must correspond to exactly " +
                "one current-wave task."
            )
        }
    }
}

$wavePathSets = @{}
foreach ($task in $waveTaskEntries) {
    if (@($task.allowed_paths).Count -eq 0) {
        throw "Current-wave task has no allowed_paths, so non-overlap cannot be proven: $($task.id)"
    }
    $wavePathSets[[string]$task.id] = @(
        foreach ($pattern in @($task.allowed_paths)) {
            ConvertTo-ConservativeAllowedPath -Pattern ([string]$pattern) -TaskId ([string]$task.id)
        }
    )
}

for ($leftIndex = 0; $leftIndex -lt $waveTaskEntries.Count; $leftIndex++) {
    for ($rightIndex = $leftIndex + 1; $rightIndex -lt $waveTaskEntries.Count; $rightIndex++) {
        $leftTask = $waveTaskEntries[$leftIndex]
        $rightTask = $waveTaskEntries[$rightIndex]
        foreach ($leftPath in @($wavePathSets[[string]$leftTask.id])) {
            foreach ($rightPath in @($wavePathSets[[string]$rightTask.id])) {
                if (Test-ConservativePathOverlap -Left $leftPath -Right $rightPath) {
                    throw (
                        "Current-wave allowed_paths overlap or cannot be proven disjoint: " +
                        "$($leftTask.id):$($leftPath.original) <-> " +
                        "$($rightTask.id):$($rightPath.original)"
                    )
                }
            }
        }
    }
}

$rootTasks = @($taskMap.Keys | Where-Object { @($taskMap[$_]).Count -eq 0 })
Write-Output (
    'WBS_VALIDATION_OK ' +
    "tasks=$($taskMap.Count) " +
    "unique=$($taskMap.Count) " +
    'missing=0 cycles=0 registry_drift=0 ' +
    "active=$(@($registry.tasks).Count) " +
    "wave=$(@($registry.current_wave.tasks).Count) " +
    "external=$($externalPrerequisites.Count) " +
    "roots=$($rootTasks -join ',')"
)
