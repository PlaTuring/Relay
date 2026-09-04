[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:FixtureId = 'P0-ARC-006-managed-core-layout-spike'
$script:RecipeId = 'alpha-core-fixture'
$script:StaticTime = '2000-01-01T00:00:00.0000000Z'
$script:ScriptRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$script:WorkRoot = [System.IO.Path]::GetFullPath((Join-Path $script:ScriptRoot 'work'))
# Windows PowerShell 5.1 treats a BOM-less UTF-8 script as the active ANSI codepage.
# Build the intended Chinese folder name from code points so the same command proves
# the exact Unicode path on both Windows PowerShell 5.1 and PowerShell 7+.
$script:UnicodeFolderName = (
    ([string][char]0x53D7) +
    ([string][char]0x7BA1) +
    ' Core ' +
    ([string][char]0x5E03) +
    ([string][char]0x5C40) +
    ([string][char]0x6D4B) +
    ([string][char]0x8BD5)
)
$script:ManagedRoot = [System.IO.Path]::GetFullPath((Join-Path $script:WorkRoot (Join-Path $script:UnicodeFolderName 'Managed Core Root')))
$script:PublicManagedRootLocator = ('work/' + $script:UnicodeFolderName + '/Managed Core Root')
$script:ControlRoot = Join-Path $script:ManagedRoot 'control'
$script:RuntimesRoot = Join-Path $script:ManagedRoot 'runtimes'
$script:RecipeRoot = Join-Path $script:RuntimesRoot $script:RecipeId
$script:ActivePointerPath = Join-Path $script:ControlRoot 'active.json'
$script:ActiveCandidatePath = Join-Path $script:ControlRoot 'active.json.next'
$script:ActiveBackupPath = Join-Path $script:ControlRoot 'active.json.previous'
$script:JournalPath = Join-Path $script:ControlRoot 'transactions\layout-spike-journal.json'
$script:EvidenceRoot = Join-Path $script:ScriptRoot 'evidence'
$script:EvidencePath = Join-Path $script:EvidenceRoot 'LAST_RUN.json'
$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $script:ScriptRoot '..\..\..'))
$script:PublicReadmePath = Join-Path $script:ScriptRoot 'README.md'
$script:PublicReportPath = Join-Path $script:RepoRoot 'docs\evidence\MANAGED_CORE_LAYOUT.md'
$script:NegativeFixtureRoot = Join-Path $script:ScriptRoot 'fixtures\negative'
$script:SafetySentinelPath = Join-Path $script:ScriptRoot 'fixtures\safety\outside-work.sentinel'
$script:JournalEvents = [System.Collections.Generic.List[object]]::new()
$script:Results = [System.Collections.Generic.List[object]]::new()

function Get-Sha256Text {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        $Value = '<null>'
    }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FileSha256 {
    param([Parameter(Mandatory)][string]$Path)

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertTo-StableJson {
    param([Parameter(Mandatory)]$InputObject)

    return (($InputObject | ConvertTo-Json -Depth 32) + [Environment]::NewLine)
}

function Write-Utf8File {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $parent -Force)
    }

    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Write-Utf8FileDurable {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $parent -Force)
    }

    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
    $stream = [System.IO.FileStream]::new(
        $Path,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough
    )
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$InputObject,
        [switch]$Durable
    )

    $json = ConvertTo-StableJson -InputObject $InputObject
    if ($Durable) {
        Write-Utf8FileDurable -Path $Path -Content $json
    }
    else {
        Write-Utf8File -Path $Path -Content $json
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory)][string]$Path)

    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Assert-True {
    param(
        [Parameter(Mandatory)][bool]$Condition,
        [Parameter(Mandatory)][string]$Message
    )

    if (-not $Condition) {
        throw [System.InvalidOperationException]::new($Message)
    }
}

function Assert-Equal {
    param(
        [AllowNull()]$Actual,
        [AllowNull()]$Expected,
        [Parameter(Mandatory)][string]$Message
    )

    if ($Actual -cne $Expected) {
        throw [System.InvalidOperationException]::new("$Message Expected=[$Expected] Actual=[$Actual]")
    }
}

function Assert-StringEqualIgnoreCase {
    param(
        [Parameter(Mandatory)][string]$Actual,
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Message
    )

    if (-not [string]::Equals($Actual, $Expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw [System.InvalidOperationException]::new("$Message Expected=[$Expected] Actual=[$Actual]")
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [Parameter(Mandatory)][string]$MessagePattern
    )

    $caught = $null
    try {
        & $Action
    }
    catch {
        $caught = $_
    }

    if ($null -eq $caught) {
        throw [System.InvalidOperationException]::new("Expected an exception matching [$MessagePattern], but no exception was thrown.")
    }

    if ($caught.Exception.Message -notmatch $MessagePattern) {
        throw [System.InvalidOperationException]::new(
            "Exception did not match [$MessagePattern]. Actual=[$($caught.Exception.Message)]"
        )
    }
}

function Add-Pass {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Evidence
    )

    $script:Results.Add([ordered]@{
        id = $Id
        status = 'pass'
        evidence = $Evidence
    })
    Write-Host "PASS $Id"
}

function Get-NormalizedPath {
    param([Parameter(Mandatory)][string]$Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Assert-PathContained {
    param(
        [Parameter(Mandatory)][string]$Candidate,
        [Parameter(Mandatory)][string]$Root,
        [switch]$AllowEqual
    )

    $candidateFull = Get-NormalizedPath -Path $Candidate
    $rootFull = Get-NormalizedPath -Path $Root

    if ($AllowEqual -and [string]::Equals($candidateFull, $rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return
    }

    $prefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw [System.InvalidOperationException]::new("Path escapes owned root. Candidate=[$candidateFull] Root=[$rootFull]")
    }
}

function Assert-NoReparsePoints {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $rootItem = Get-Item -LiteralPath $Path -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw [System.InvalidOperationException]::new("Reparse point rejected at owned target [$($rootItem.FullName)].")
    }

    if ($rootItem.PSIsContainer) {
        foreach ($item in (Get-ChildItem -LiteralPath $Path -Force -Recurse)) {
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw [System.InvalidOperationException]::new("Reparse point rejected at owned target [$($item.FullName)].")
            }
        }
    }
}

function Assert-StaticFixtureIntegrity {
    param()

    $required = @(
        (Join-Path $script:NegativeFixtureRoot 'incomplete-active.json'),
        (Join-Path $script:NegativeFixtureRoot 'staging-origin-manifest.json'),
        (Join-Path $script:NegativeFixtureRoot 'unowned-active.json'),
        $script:SafetySentinelPath
    )
    foreach ($path in $required) {
        Assert-True -Condition (Test-Path -LiteralPath $path -PathType Leaf) -Message "Missing static fixture [$path]."
        Assert-PathContained -Candidate $path -Root $script:ScriptRoot
    }
}

function Reset-OwnedWorkRoot {
    param()

    Assert-PathContained -Candidate $script:WorkRoot -Root $script:ScriptRoot
    Assert-True -Condition ((Split-Path -Leaf $script:WorkRoot) -ceq 'work') -Message 'Reset target must be the exact managed-core-layout work directory.'

    if (Test-Path -LiteralPath $script:WorkRoot) {
        $markerPath = Join-Path $script:WorkRoot '.fixture-owner.json'
        Assert-True -Condition (Test-Path -LiteralPath $markerPath -PathType Leaf) -Message 'Existing work root has no fixture ownership marker; refusing recursive delete.'
        $marker = Read-JsonFile -Path $markerPath
        Assert-Equal -Actual ([string]$marker.fixture_id) -Expected $script:FixtureId -Message 'Work-root owner mismatch.'
        Assert-StringEqualIgnoreCase -Actual ([string]$marker.owned_root) -Expected $script:WorkRoot -Message 'Work-root path mismatch.'
        Assert-NoReparsePoints -Path $script:WorkRoot
        Remove-Item -LiteralPath $script:WorkRoot -Recurse -Force
    }

    [void](New-Item -ItemType Directory -Path $script:WorkRoot -Force)
    Write-JsonFile -Path (Join-Path $script:WorkRoot '.fixture-owner.json') -InputObject ([ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        owned_root = $script:WorkRoot
        purpose = 'Disposable P0-ARC-006 fixture only'
    }) -Durable
}

function Initialize-ManagedLayout {
    param()

    [void](New-Item -ItemType Directory -Path $script:ControlRoot -Force)
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $script:JournalPath) -Force)
    [void](New-Item -ItemType Directory -Path $script:RecipeRoot -Force)

    Write-JsonFile -Path (Join-Path $script:ManagedRoot '.managed-root-owner.json') -InputObject ([ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        managed_root = $script:ManagedRoot
        scope = 'prototype-only'
    }) -Durable
}

function Write-JournalEvent {
    param(
        [Parameter(Mandatory)][string]$Event,
        [AllowNull()][string]$GenerationId,
        [AllowNull()][string]$GenerationPath
    )

    if ($null -ne $GenerationPath) {
        Assert-PathContained -Candidate $GenerationPath -Root $script:ManagedRoot
    }

    $script:JournalEvents.Add([ordered]@{
        sequence = $script:JournalEvents.Count + 1
        at = $script:StaticTime
        event = $Event
        generation_id = $GenerationId
        final_generation_path = $GenerationPath
    })

    Write-JsonFile -Path $script:JournalPath -InputObject ([ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        managed_root = $script:ManagedRoot
        events = @($script:JournalEvents)
    }) -Durable
}

function Get-GenerationPath {
    param([Parameter(Mandatory)][string]$GenerationId)

    Assert-True -Condition ($GenerationId -match '^gen-[a-z0-9-]+$') -Message "Invalid generation id [$GenerationId]."
    $path = [System.IO.Path]::GetFullPath((Join-Path $script:RecipeRoot $GenerationId))
    Assert-PathContained -Candidate $path -Root $script:RecipeRoot
    return $path
}

function Get-ArtifactRecord {
    param(
        [Parameter(Mandatory)][string]$GenerationPath,
        [Parameter(Mandatory)][string]$RelativePath
    )

    Assert-True -Condition (-not [System.IO.Path]::IsPathRooted($RelativePath)) -Message "Artifact path must be relative [$RelativePath]."
    Assert-True -Condition ($RelativePath -notmatch '(^|[\\/])\.\.([\\/]|$)') -Message "Artifact traversal rejected [$RelativePath]."
    Assert-True -Condition ($RelativePath -notmatch ':') -Message "Artifact ADS/drive syntax rejected [$RelativePath]."
    $full = [System.IO.Path]::GetFullPath((Join-Path $GenerationPath $RelativePath))
    Assert-PathContained -Candidate $full -Root $GenerationPath
    Assert-True -Condition (Test-Path -LiteralPath $full -PathType Leaf) -Message "Artifact missing [$full]."

    return [ordered]@{
        relative_path = $RelativePath.Replace('/', '\')
        size_bytes = (Get-Item -LiteralPath $full).Length
        sha256 = Get-FileSha256 -Path $full
    }
}

function New-FakeGeneration {
    param(
        [Parameter(Mandatory)][string]$GenerationId,
        [ValidateSet('none', 'after-private-python')][string]$Fault = 'none'
    )

    $generationPath = Get-GenerationPath -GenerationId $GenerationId
    Assert-True -Condition (-not (Test-Path -LiteralPath $generationPath)) -Message "Generation already exists [$generationPath]."

    # The generation directory is the immutable final path. No populated environment
    # is ever constructed elsewhere and no runtime/venv relocation operation exists.
    [void](New-Item -ItemType Directory -Path $generationPath -Force)
    Write-JsonFile -Path (Join-Path $generationPath '.managed-core-owner.json') -InputObject ([ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        managed_root = $script:ManagedRoot
        recipe_id = $script:RecipeId
        generation_id = $GenerationId
        final_generation_path = $generationPath
    }) -Durable

    Write-JournalEvent -Event 'generation_created_at_final_path' -GenerationId $GenerationId -GenerationPath $generationPath

    $privatePythonRoot = Join-Path $generationPath 'private-python'
    $runtimeRoot = Join-Path $generationPath 'runtime\Comfy Fixture'
    [void](New-Item -ItemType Directory -Path $privatePythonRoot -Force)
    [void](New-Item -ItemType Directory -Path $runtimeRoot -Force)

    $fakePython = Join-Path $privatePythonRoot 'python.exe.fixture'
    $fakeConfig = Join-Path $privatePythonRoot 'pyvenv.cfg.fixture'
    $fakeRuntime = Join-Path $runtimeRoot 'main.py.fixture'

    Write-Utf8File -Path $fakePython -Content "INERT FIXTURE - NOT AN EXECUTABLE`nprivate_path=$privatePythonRoot`n"
    Write-Utf8File -Path $fakeConfig -Content "fixture = true`nhome = $privatePythonRoot`nexecutable = $fakePython`nrelocated = false`n"
    Write-Utf8File -Path $fakeRuntime -Content "# Inert ComfyUI-shaped fixture; never imported or executed.`nRUNTIME_ROOT = r'$runtimeRoot'`n"

    $buildingManifest = [ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        recipe_id = $script:RecipeId
        generation_id = $GenerationId
        state = 'building'
        build_root = $generationPath
        construction_method = 'direct-final-path'
        environment_relocated = $false
        private_python_root = $privatePythonRoot
        private_python_executable = $fakePython
        runtime_root = $runtimeRoot
        runtime_entry_relative = 'runtime\Comfy Fixture\main.py.fixture'
        verification_receipt_relative = 'verification.json'
        artifacts = @()
    }
    $manifestPath = Join-Path $generationPath 'manifest.json'
    Write-JsonFile -Path $manifestPath -InputObject $buildingManifest -Durable

    if ($Fault -ceq 'after-private-python') {
        Write-JournalEvent -Event 'build_interrupted_before_verification' -GenerationId $GenerationId -GenerationPath $generationPath
        throw [System.InvalidOperationException]::new("Injected build interruption for [$GenerationId].")
    }

    $artifacts = @(
        (Get-ArtifactRecord -GenerationPath $generationPath -RelativePath 'private-python\python.exe.fixture'),
        (Get-ArtifactRecord -GenerationPath $generationPath -RelativePath 'private-python\pyvenv.cfg.fixture'),
        (Get-ArtifactRecord -GenerationPath $generationPath -RelativePath 'runtime\Comfy Fixture\main.py.fixture')
    )

    $verifiedManifest = [ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        recipe_id = $script:RecipeId
        generation_id = $GenerationId
        state = 'verified'
        build_root = $generationPath
        construction_method = 'direct-final-path'
        environment_relocated = $false
        private_python_root = $privatePythonRoot
        private_python_executable = $fakePython
        runtime_root = $runtimeRoot
        runtime_entry_relative = 'runtime\Comfy Fixture\main.py.fixture'
        verification_receipt_relative = 'verification.json'
        artifacts = $artifacts
    }
    Write-JsonFile -Path $manifestPath -InputObject $verifiedManifest -Durable
    $manifestHash = Get-FileSha256 -Path $manifestPath

    Write-JsonFile -Path (Join-Path $generationPath 'verification.json') -InputObject ([ordered]@{
        schema_version = 1
        fixture_id = $script:FixtureId
        generation_id = $GenerationId
        manifest_sha256 = $manifestHash
        verified_at = $script:StaticTime
        checks = @(
            'owned-final-path',
            'private-environment-is-final-path-bound',
            'artifact-hashes-match',
            'no-relocation'
        )
    }) -Durable

    Write-JournalEvent -Event 'generation_verified' -GenerationId $GenerationId -GenerationPath $generationPath
    return [ordered]@{
        generation_id = $GenerationId
        generation_path = $generationPath
        manifest_sha256 = $manifestHash
    }
}

function Assert-GenerationOwned {
    param(
        [Parameter(Mandatory)][string]$GenerationId,
        [Parameter(Mandatory)][string]$GenerationPath
    )

    $expectedPath = Get-GenerationPath -GenerationId $GenerationId
    Assert-StringEqualIgnoreCase -Actual (Get-NormalizedPath -Path $GenerationPath) -Expected (Get-NormalizedPath -Path $expectedPath) -Message 'Generation path/id mismatch.'
    Assert-PathContained -Candidate $GenerationPath -Root $script:RecipeRoot
    Assert-NoReparsePoints -Path $GenerationPath

    $ownerPath = Join-Path $GenerationPath '.managed-core-owner.json'
    Assert-True -Condition (Test-Path -LiteralPath $ownerPath -PathType Leaf) -Message "Generation is not tool-owned: missing owner marker [$GenerationId]."
    $owner = Read-JsonFile -Path $ownerPath
    Assert-Equal -Actual ([string]$owner.fixture_id) -Expected $script:FixtureId -Message 'Generation fixture owner mismatch.'
    Assert-Equal -Actual ([string]$owner.recipe_id) -Expected $script:RecipeId -Message 'Generation recipe owner mismatch.'
    Assert-Equal -Actual ([string]$owner.generation_id) -Expected $GenerationId -Message 'Generation id owner mismatch.'
    Assert-StringEqualIgnoreCase -Actual ([string]$owner.final_generation_path) -Expected $GenerationPath -Message 'Owner final path mismatch.'
}

function Assert-ManifestPolicy {
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$GenerationId,
        [Parameter(Mandatory)][string]$GenerationPath
    )

    $manifestText = $Manifest | ConvertTo-Json -Depth 32 -Compress
    Assert-True -Condition ($manifestText -notmatch '(?i)staging') -Message 'Manifest contains a forbidden staging reference.'
    Assert-Equal -Actual ([string]$Manifest.fixture_id) -Expected $script:FixtureId -Message 'Manifest fixture owner mismatch.'
    Assert-Equal -Actual ([string]$Manifest.recipe_id) -Expected $script:RecipeId -Message 'Manifest recipe mismatch.'
    Assert-Equal -Actual ([string]$Manifest.generation_id) -Expected $GenerationId -Message 'Manifest generation mismatch.'
    Assert-Equal -Actual ([string]$Manifest.state) -Expected 'verified' -Message 'Generation is incomplete and cannot activate.'
    Assert-StringEqualIgnoreCase -Actual ([string]$Manifest.build_root) -Expected $GenerationPath -Message 'Manifest build root is not the final generation path.'
    Assert-Equal -Actual ([string]$Manifest.construction_method) -Expected 'direct-final-path' -Message 'Manifest does not prove direct final-path construction.'
    Assert-True -Condition (-not [bool]$Manifest.environment_relocated) -Message 'Relocated private environment is forbidden.'

    foreach ($absolutePath in @(
        [string]$Manifest.private_python_root,
        [string]$Manifest.private_python_executable,
        [string]$Manifest.runtime_root
    )) {
        Assert-PathContained -Candidate $absolutePath -Root $GenerationPath
    }
}

function Assert-GenerationReady {
    param([Parameter(Mandatory)][string]$GenerationId)

    $generationPath = Get-GenerationPath -GenerationId $GenerationId
    Assert-True -Condition (Test-Path -LiteralPath $generationPath -PathType Container) -Message "Generation path is missing [$GenerationId]."
    Assert-GenerationOwned -GenerationId $GenerationId -GenerationPath $generationPath

    $manifestPath = Join-Path $generationPath 'manifest.json'
    Assert-True -Condition (Test-Path -LiteralPath $manifestPath -PathType Leaf) -Message "Generation manifest missing [$GenerationId]."
    $manifest = Read-JsonFile -Path $manifestPath
    Assert-ManifestPolicy -Manifest $manifest -GenerationId $GenerationId -GenerationPath $generationPath

    foreach ($artifact in @($manifest.artifacts)) {
        $record = Get-ArtifactRecord -GenerationPath $generationPath -RelativePath ([string]$artifact.relative_path)
        Assert-Equal -Actual ([long]$record.size_bytes) -Expected ([long]$artifact.size_bytes) -Message 'Artifact size mismatch.'
        Assert-Equal -Actual ([string]$record.sha256) -Expected ([string]$artifact.sha256) -Message 'Artifact hash mismatch.'
    }

    $receiptRelative = [string]$manifest.verification_receipt_relative
    Assert-True -Condition (-not [System.IO.Path]::IsPathRooted($receiptRelative)) -Message 'Verification receipt path must be relative.'
    $receiptPath = [System.IO.Path]::GetFullPath((Join-Path $generationPath $receiptRelative))
    Assert-PathContained -Candidate $receiptPath -Root $generationPath
    Assert-True -Condition (Test-Path -LiteralPath $receiptPath -PathType Leaf) -Message 'Verification receipt missing.'
    $receipt = Read-JsonFile -Path $receiptPath
    Assert-Equal -Actual ([string]$receipt.fixture_id) -Expected $script:FixtureId -Message 'Receipt owner mismatch.'
    Assert-Equal -Actual ([string]$receipt.generation_id) -Expected $GenerationId -Message 'Receipt generation mismatch.'
    $manifestHash = Get-FileSha256 -Path $manifestPath
    Assert-Equal -Actual ([string]$receipt.manifest_sha256) -Expected $manifestHash -Message 'Receipt does not match manifest.'

    return [ordered]@{
        generation_id = $GenerationId
        generation_path = $generationPath
        manifest_sha256 = $manifestHash
    }
}

function New-ActivePointerDocument {
    param([Parameter(Mandatory)]$ReadyGeneration)

    return [ordered]@{
        schema_version = 1
        recipe_id = $script:RecipeId
        generation_id = [string]$ReadyGeneration.generation_id
        manifest_sha256 = [string]$ReadyGeneration.manifest_sha256
    }
}

function Assert-PointerDocumentReady {
    param([Parameter(Mandatory)]$Pointer)

    Assert-Equal -Actual ([string]$Pointer.schema_version) -Expected '1' -Message 'Pointer schema mismatch.'
    Assert-Equal -Actual ([string]$Pointer.recipe_id) -Expected $script:RecipeId -Message 'Pointer recipe mismatch.'
    $ready = Assert-GenerationReady -GenerationId ([string]$Pointer.generation_id)
    Assert-Equal -Actual ([string]$Pointer.manifest_sha256) -Expected ([string]$ready.manifest_sha256) -Message 'Pointer manifest hash mismatch.'
    return $ready
}

function Publish-ActivePointer {
    param(
        [Parameter(Mandatory)][string]$GenerationId,
        [switch]$FaultBeforeReplace
    )

    $ready = Assert-GenerationReady -GenerationId $GenerationId
    $pointer = New-ActivePointerDocument -ReadyGeneration $ready
    $json = ConvertTo-StableJson -InputObject $pointer
    $byteCount = [System.Text.UTF8Encoding]::new($false).GetByteCount($json)
    Assert-True -Condition ($byteCount -lt 4096) -Message "Active pointer exceeds 4 KiB [$byteCount]."
    Assert-True -Condition ($json -notmatch '(?i)staging') -Message 'Active pointer contains a forbidden staging reference.'
    Assert-True -Condition ($json -notmatch [regex]::Escape($script:ManagedRoot)) -Message 'Active pointer must not contain an absolute managed-root path.'

    Assert-PathContained -Candidate $script:ActiveCandidatePath -Root $script:ControlRoot
    Write-Utf8FileDurable -Path $script:ActiveCandidatePath -Content $json
    Write-JournalEvent -Event 'active_candidate_flushed' -GenerationId $GenerationId -GenerationPath ([string]$ready.generation_path)

    if ($FaultBeforeReplace) {
        throw [System.InvalidOperationException]::new("Injected interruption before active pointer replacement for [$GenerationId].")
    }

    if (Test-Path -LiteralPath $script:ActivePointerPath -PathType Leaf) {
        Assert-PathContained -Candidate $script:ActiveBackupPath -Root $script:ControlRoot
        [System.IO.File]::Replace($script:ActiveCandidatePath, $script:ActivePointerPath, $script:ActiveBackupPath, $true)
        if (Test-Path -LiteralPath $script:ActiveBackupPath) {
            Assert-PathContained -Candidate $script:ActiveBackupPath -Root $script:ControlRoot
            Remove-Item -LiteralPath $script:ActiveBackupPath -Force
        }
    }
    else {
        [System.IO.File]::Move($script:ActiveCandidatePath, $script:ActivePointerPath)
    }

    Write-JournalEvent -Event 'active_pointer_replaced' -GenerationId $GenerationId -GenerationPath ([string]$ready.generation_path)
    return $pointer
}

function Resolve-ActiveGeneration {
    param()

    Assert-True -Condition (Test-Path -LiteralPath $script:ActivePointerPath -PathType Leaf) -Message 'No active pointer exists.'
    $pointerItem = Get-Item -LiteralPath $script:ActivePointerPath
    Assert-True -Condition ($pointerItem.Length -lt 4096) -Message 'Active pointer exceeds 4 KiB.'
    $pointerText = Get-Content -LiteralPath $script:ActivePointerPath -Raw -Encoding UTF8
    Assert-True -Condition ($pointerText -notmatch '(?i)staging') -Message 'Active pointer contains a forbidden staging reference.'
    $pointer = $pointerText | ConvertFrom-Json
    return (Assert-PointerDocumentReady -Pointer $pointer)
}

function Remove-OwnedGeneration {
    param([Parameter(Mandatory)][string]$GenerationId)

    $generationPath = Get-GenerationPath -GenerationId $GenerationId
    Assert-True -Condition (Test-Path -LiteralPath $generationPath -PathType Container) -Message "Generation path missing [$GenerationId]."
    Assert-GenerationOwned -GenerationId $GenerationId -GenerationPath $generationPath

    if (Test-Path -LiteralPath $script:ActivePointerPath -PathType Leaf) {
        $active = Read-JsonFile -Path $script:ActivePointerPath
        Assert-True -Condition (([string]$active.generation_id) -cne $GenerationId) -Message "Refusing to delete active generation [$GenerationId]."
    }

    Assert-PathContained -Candidate $generationPath -Root $script:RecipeRoot
    Assert-NoReparsePoints -Path $generationPath
    Remove-Item -LiteralPath $generationPath -Recurse -Force
    Write-JournalEvent -Event 'owned_inactive_generation_deleted' -GenerationId $GenerationId -GenerationPath $generationPath
}

function Get-RegistryPathValue {
    param([Parameter(Mandatory)][string]$LiteralPath)

    try {
        return [string](Get-ItemPropertyValue -LiteralPath $LiteralPath -Name Path -ErrorAction Stop)
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        return $null
    }
    catch [System.Management.Automation.PSArgumentException] {
        return $null
    }
}

function Get-PythonDiscoverySnapshot {
    param()

    $command = Get-Command python -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        return [ordered]@{
            command_type = $null
            source = $null
            file_access = 'not-found'
            file_sha256 = $null
            file_length = $null
            last_write_utc = $null
        }
    }

    $source = [string]$command.Source
    $fileHash = $null
    $fileLength = $null
    $lastWrite = $null
    $fileAccess = 'not-a-file'
    if ($source -and (Test-Path -LiteralPath $source -PathType Leaf)) {
        try {
            $item = Get-Item -LiteralPath $source -ErrorAction Stop
            $fileHash = Get-FileSha256 -Path $source
            $fileLength = $item.Length
            $lastWrite = $item.LastWriteTimeUtc.ToString('o')
            $fileAccess = 'readable'
        }
        catch {
            # WindowsApps commonly exposes an execution alias that cannot be read.
            # Record that stable discovery fact without invoking or modifying it.
            $fileAccess = 'unreadable'
        }
    }

    return [ordered]@{
        command_type = [string]$command.CommandType
        source = $source
        file_access = $fileAccess
        file_sha256 = $fileHash
        file_length = $fileLength
        last_write_utc = $lastWrite
    }
}

function Get-GlobalStateSnapshot {
    param()

    return [ordered]@{
        process_path = [string]$env:Path
        user_path = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
        machine_path = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::Machine)
        registry_user_path = Get-RegistryPathValue -LiteralPath 'Registry::HKEY_CURRENT_USER\Environment'
        registry_machine_path = Get-RegistryPathValue -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
        discovered_python = Get-PythonDiscoverySnapshot
    }
}

function Get-GlobalStateDigest {
    param([Parameter(Mandatory)]$Snapshot)

    return Get-Sha256Text -Value ($Snapshot | ConvertTo-Json -Depth 10 -Compress)
}

function Assert-NoPositiveStagingReferences {
    param()

    foreach ($item in (Get-ChildItem -LiteralPath $script:ManagedRoot -Force -Recurse)) {
        Assert-True -Condition ($item.FullName -notmatch '(?i)staging') -Message "Managed path contains forbidden staging reference [$($item.FullName)]."
        if (-not $item.PSIsContainer -and $item.Extension -in @('.json', '.fixture', '.cfg')) {
            $text = Get-Content -LiteralPath $item.FullName -Raw -Encoding UTF8
            Assert-True -Condition ($text -notmatch '(?i)staging') -Message "Managed file contains forbidden staging reference [$($item.FullName)]."
        }
    }
}

function Assert-PublicTextSanitized {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content
    )

    $currentUserName = [Environment]::UserName
    if (-not [string]::IsNullOrWhiteSpace($currentUserName)) {
        Assert-True -Condition ($Content.IndexOf($currentUserName, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) -Message "$Label contains the current account name."
    }

    Assert-True -Condition ($Content -notmatch '(?i)[a-z]:[\\/]+users[\\/]') -Message "$Label contains a Windows user-profile absolute path."
}

function Invoke-Spike {
    param()

    Assert-StaticFixtureIntegrity
    $sentinelHashBefore = Get-FileSha256 -Path $script:SafetySentinelPath
    $globalBefore = Get-GlobalStateSnapshot
    $globalBeforeDigest = Get-GlobalStateDigest -Snapshot $globalBefore

    Reset-OwnedWorkRoot
    Initialize-ManagedLayout

    $driveRoot = [System.IO.Path]::GetPathRoot($script:ManagedRoot)
    $drive = [System.IO.DriveInfo]::new($driveRoot)
    Assert-Equal -Actual ([string]$drive.DriveType) -Expected 'Fixed' -Message 'Fixture must be on a local fixed volume.'
    Assert-Equal -Actual ([string]$drive.DriveFormat) -Expected 'NTFS' -Message 'Fixture must be on NTFS.'
    Assert-True -Condition ($script:ManagedRoot.Contains(' ')) -Message 'Managed root must contain a space.'
    Assert-True -Condition ($script:ManagedRoot -match '[^\x00-\x7F]') -Message 'Managed root must contain non-ASCII characters.'
    Add-Pass -Id 'fixed_ntfs_space_unicode_root' -Evidence "Selected workspace volume is Fixed/$($drive.DriveFormat); managed root contains spaces and Chinese characters."

    $gen1 = New-FakeGeneration -GenerationId 'gen-0001'
    Assert-StringEqualIgnoreCase -Actual ([string]$gen1.generation_path) -Expected (Get-GenerationPath -GenerationId 'gen-0001') -Message 'Generation was not created at final path.'
    $gen1Manifest = Read-JsonFile -Path (Join-Path ([string]$gen1.generation_path) 'manifest.json')
    Assert-Equal -Actual ([string]$gen1Manifest.construction_method) -Expected 'direct-final-path' -Message 'Final-path construction marker absent.'
    Assert-True -Condition (-not [bool]$gen1Manifest.environment_relocated) -Message 'Private environment reports relocation.'
    Add-Pass -Id 'generation_built_directly_at_final_path' -Evidence 'gen-0001 private runtime and fake Python were created inside their final immutable generation path.'

    $privateConfig = Get-Content -LiteralPath (Join-Path ([string]$gen1.generation_path) 'private-python\pyvenv.cfg.fixture') -Raw -Encoding UTF8
    Assert-True -Condition ($privateConfig.Contains([string]$gen1Manifest.private_python_root)) -Message 'Fake environment is not bound to its final absolute path.'
    Assert-True -Condition ($privateConfig -match 'relocated = false') -Message 'Fake environment relocation policy missing.'
    Add-Pass -Id 'private_environment_final_path_bound' -Evidence 'Inert pyvenv fixture embeds only the final absolute private path and reports relocated=false.'

    [void](Publish-ActivePointer -GenerationId 'gen-0001')
    $active1 = Resolve-ActiveGeneration
    Assert-Equal -Actual ([string]$active1.generation_id) -Expected 'gen-0001' -Message 'Initial active generation mismatch.'
    Add-Pass -Id 'verified_generation_activates' -Evidence 'Only verified, owned gen-0001 was published through active.json.'

    Assert-Throws -Action { New-FakeGeneration -GenerationId 'gen-build-interrupted' -Fault 'after-private-python' } -MessagePattern 'Injected build interruption'
    $interruptedPath = Get-GenerationPath -GenerationId 'gen-build-interrupted'
    $interruptedManifest = Read-JsonFile -Path (Join-Path $interruptedPath 'manifest.json')
    Assert-Equal -Actual ([string]$interruptedManifest.state) -Expected 'building' -Message 'Interrupted generation state mismatch.'
    Assert-Throws -Action { Publish-ActivePointer -GenerationId 'gen-build-interrupted' } -MessagePattern 'incomplete'
    Assert-Equal -Actual ([string](Resolve-ActiveGeneration).generation_id) -Expected 'gen-0001' -Message 'Interrupted generation changed the active pointer.'
    Add-Pass -Id 'build_interrupt_preserves_old_active' -Evidence 'Interrupted generation remains building, is not activatable, and gen-0001 stays active.'

    $gen2 = New-FakeGeneration -GenerationId 'gen-0002'
    Assert-Throws -Action { Publish-ActivePointer -GenerationId 'gen-0002' -FaultBeforeReplace } -MessagePattern 'before active pointer replacement'
    Assert-True -Condition (Test-Path -LiteralPath $script:ActiveCandidatePath -PathType Leaf) -Message 'Fault injection did not leave the flushed candidate for diagnosis/retry.'
    Assert-Equal -Actual ([string](Resolve-ActiveGeneration).generation_id) -Expected 'gen-0001' -Message 'Pre-replace interruption changed active generation.'
    Add-Pass -Id 'pre_replace_interrupt_preserves_old_active' -Evidence 'A durable .next exists, but active.json still resolves to gen-0001.'

    [void](Publish-ActivePointer -GenerationId 'gen-0002')
    Assert-Equal -Actual ([string](Resolve-ActiveGeneration).generation_id) -Expected 'gen-0002' -Message 'Atomic retry did not activate gen-0002.'
    Assert-True -Condition (-not (Test-Path -LiteralPath $script:ActiveCandidatePath)) -Message 'Candidate remained after successful replacement.'
    Assert-True -Condition (-not (Test-Path -LiteralPath $script:ActiveBackupPath)) -Message 'Pointer backup remained after successful replacement.'
    Add-Pass -Id 'atomic_pointer_retry_switches_generation' -Evidence 'Same-directory File.Replace atomically switched active.json to verified gen-0002.'

    Assert-Throws -Action { New-FakeGeneration -GenerationId 'gen-incomplete-pointer' -Fault 'after-private-python' } -MessagePattern 'Injected build interruption'
    $incompletePointer = Read-JsonFile -Path (Join-Path $script:NegativeFixtureRoot 'incomplete-active.json')
    Assert-Throws -Action { Assert-PointerDocumentReady -Pointer $incompletePointer } -MessagePattern 'incomplete'
    Assert-Equal -Actual ([string](Resolve-ActiveGeneration).generation_id) -Expected 'gen-0002' -Message 'Negative incomplete pointer changed the real active pointer.'
    Add-Pass -Id 'negative_incomplete_pointer_rejected' -Evidence 'Static pointer fixture targeting a building generation is rejected; real active.json is unchanged.'

    $stagingManifest = Read-JsonFile -Path (Join-Path $script:NegativeFixtureRoot 'staging-origin-manifest.json')
    Assert-Throws -Action {
        Assert-ManifestPolicy -Manifest $stagingManifest -GenerationId 'gen-negative-origin' -GenerationPath (Get-GenerationPath -GenerationId 'gen-negative-origin')
    } -MessagePattern 'forbidden staging reference'
    Add-Pass -Id 'negative_staging_origin_rejected' -Evidence 'Static manifest containing a staging-origin sentinel fails closed before readiness checks.'

    $unownedPath = Get-GenerationPath -GenerationId 'gen-unowned'
    [void](New-Item -ItemType Directory -Path $unownedPath -Force)
    Write-Utf8File -Path (Join-Path $unownedPath 'foreign.fixture') -Content "unowned fixture`n"
    $unownedPointer = Read-JsonFile -Path (Join-Path $script:NegativeFixtureRoot 'unowned-active.json')
    Assert-Throws -Action { Assert-PointerDocumentReady -Pointer $unownedPointer } -MessagePattern 'not tool-owned'
    Assert-Throws -Action { Remove-OwnedGeneration -GenerationId 'gen-unowned' } -MessagePattern 'not tool-owned'
    Assert-True -Condition (Test-Path -LiteralPath $unownedPath -PathType Container) -Message 'Unowned directory was unexpectedly deleted.'
    Add-Pass -Id 'unowned_switch_and_delete_rejected' -Evidence 'Generation without this fixture owner marker can neither activate nor be deleted.'

    [void](New-FakeGeneration -GenerationId 'gen-disposable')
    Remove-OwnedGeneration -GenerationId 'gen-disposable'
    Assert-True -Condition (-not (Test-Path -LiteralPath (Get-GenerationPath -GenerationId 'gen-disposable'))) -Message 'Owned inactive generation was not deleted.'
    Assert-Throws -Action { Remove-OwnedGeneration -GenerationId 'gen-0002' } -MessagePattern 'active generation'
    Assert-True -Condition (Test-Path -LiteralPath (Get-GenerationPath -GenerationId 'gen-0002') -PathType Container) -Message 'Active generation was unexpectedly deleted.'
    Add-Pass -Id 'delete_scope_requires_owned_inactive_generation' -Evidence 'Owned inactive fixture deletion succeeds; active fixture deletion is refused.'

    [void](Publish-ActivePointer -GenerationId 'gen-0001')
    Assert-Equal -Actual ([string](Resolve-ActiveGeneration).generation_id) -Expected 'gen-0001' -Message 'Switch-back to owned gen-0001 failed.'
    Add-Pass -Id 'switch_scope_requires_verified_owned_generation' -Evidence 'Switch-back succeeds only after ownership/readiness/hash validation of gen-0001.'

    Assert-NoPositiveStagingReferences
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $script:ManagedRoot 'staging'))) -Message 'A staging directory exists under managed root.'
    Add-Pass -Id 'positive_state_has_no_staging_reference' -Evidence 'Managed paths plus journal/manifests/config fixtures contain no staging token or directory.'

    $pointerItem = Get-Item -LiteralPath $script:ActivePointerPath
    $pointerText = Get-Content -LiteralPath $script:ActivePointerPath -Raw -Encoding UTF8
    Assert-True -Condition ($pointerItem.Length -lt 4096) -Message 'Final active pointer is not small.'
    Assert-True -Condition ($pointerText -notmatch ':\\') -Message 'Final active pointer contains an absolute Windows path.'
    Add-Pass -Id 'active_pointer_is_small_and_relative' -Evidence "active.json is $($pointerItem.Length) bytes and contains no absolute path."

    $globalAfter = Get-GlobalStateSnapshot
    $globalAfterDigest = Get-GlobalStateDigest -Snapshot $globalAfter
    Assert-Equal -Actual $globalAfterDigest -Expected $globalBeforeDigest -Message 'Process/user/machine PATH, registry PATH, or discovered user Python changed.'
    Add-Pass -Id 'global_path_registry_python_unchanged' -Evidence "Before/after global-state digest is $globalAfterDigest; Python was discovered read-only and never invoked."

    $sentinelHashAfter = Get-FileSha256 -Path $script:SafetySentinelPath
    Assert-Equal -Actual $sentinelHashAfter -Expected $sentinelHashBefore -Message 'Out-of-work safety sentinel changed.'
    Assert-True -Condition (Test-Path -LiteralPath $unownedPath -PathType Container) -Message 'Unowned negative fixture did not survive operations.'
    Add-Pass -Id 'only_owned_fixture_targets_mutated' -Evidence 'Outside-work sentinel and unowned generation remain byte-for-byte/present after reset, switch, and delete tests.'

    Assert-True -Condition (Test-Path -LiteralPath $script:PublicReadmePath -PathType Leaf) -Message 'Public prototype README is missing.'
    Assert-True -Condition (Test-Path -LiteralPath $script:PublicReportPath -PathType Leaf) -Message 'Public evidence report is missing.'
    Assert-PublicTextSanitized -Label 'README.md' -Content (Get-Content -LiteralPath $script:PublicReadmePath -Raw -Encoding UTF8)
    Assert-PublicTextSanitized -Label 'MANAGED_CORE_LAYOUT.md' -Content (Get-Content -LiteralPath $script:PublicReportPath -Raw -Encoding UTF8)
    $script:Results.Add([ordered]@{
        id = 'public_evidence_is_profile_path_sanitized'
        status = 'pass'
        evidence = 'README, report, and final machine evidence contain neither the current account name nor a Windows user-profile absolute path.'
    })

    $evidence = [ordered]@{
        schema_version = 1
        task = 'P0-ARC-006'
        status = 'pass'
        deterministic_time = $script:StaticTime
        managed_root = $script:PublicManagedRootLocator
        volume = [ordered]@{
            drive_type = [string]$drive.DriveType
            format = $drive.DriveFormat
        }
        boundaries = [ordered]@{
            real_comfyui_started = $false
            real_h3_started = $false
            models_downloaded = $false
            gpu_used = $false
            network_used = $false
            cloud_api_used = $false
            python_invoked = $false
            global_path_or_registry_written = $false
        }
        global_state_digest_before = $globalBeforeDigest
        global_state_digest_after = $globalAfterDigest
        final_active_generation = [string](Resolve-ActiveGeneration).generation_id
        final_active_pointer_bytes = (Get-Item -LiteralPath $script:ActivePointerPath).Length
        result_count = $script:Results.Count
        results = @($script:Results)
    }

    $evidenceJson = ConvertTo-StableJson -InputObject $evidence
    Assert-PublicTextSanitized -Label 'LAST_RUN.json candidate' -Content $evidenceJson
    [void](New-Item -ItemType Directory -Path $script:EvidenceRoot -Force)
    Write-Utf8FileDurable -Path $script:EvidencePath -Content $evidenceJson
    Assert-PublicTextSanitized -Label 'LAST_RUN.json' -Content (Get-Content -LiteralPath $script:EvidencePath -Raw -Encoding UTF8)
    Write-Host 'PASS public_evidence_is_profile_path_sanitized'
    Write-Host 'PASS evidence_written evidence/LAST_RUN.json'
    Write-Host "RESULT $($script:Results.Count)/$($script:Results.Count) checks passed"
}

try {
    Invoke-Spike
    exit 0
}
catch {
    Write-Error $_
    exit 1
}
