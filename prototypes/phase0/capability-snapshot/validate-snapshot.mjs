import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const snapshotPath = resolve(scriptDirectory, '..', 'capability-snapshot.json')
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

function fingerprint(contract) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(contract)), 'utf8')
    .digest('hex')}`
}

for (const node of snapshot.local_node_allowlist_seed) {
  const actual = fingerprint(node.schema_contract)
  if (actual !== node.schema_fingerprint) {
    throw new Error(
      `${node.class_type}: schema fingerprint ${actual} != ${node.schema_fingerprint}`
    )
  }
}

for (const surface of snapshot.non_node_runtime_surfaces) {
  const actual = fingerprint(surface.surface_contract)
  if (actual !== surface.surface_fingerprint) {
    throw new Error(
      `${surface.id}: surface fingerprint ${actual} != ${surface.surface_fingerprint}`
    )
  }
}

const validStatuses = new Set(['proven', 'poc_pending', 'experimental'])
const gateIds = new Set(snapshot.gates.map(({ id }) => id))
const invalidStatuses = []
const invalidGateReferences = []

function validateTree(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTree(item, `${path}[${index}]`))
    return
  }

  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (
      ['status', 'product_readiness', 'runtime_acceptance'].includes(key) &&
      !validStatuses.has(child)
    ) {
      invalidStatuses.push(`${childPath}=${String(child)}`)
    }

    if (
      [
        'required_gates',
        'required_license_gates',
        'required_test_gates',
        'optional_test_gates'
      ].includes(key) &&
      Array.isArray(child)
    ) {
      for (const gateId of child) {
        if (gateId.startsWith('GATE-') && !gateIds.has(gateId)) {
          invalidGateReferences.push(`${childPath}=${gateId}`)
        }
      }
    }

    validateTree(child, childPath)
  }
}

validateTree(snapshot)

if (invalidStatuses.length > 0) {
  throw new Error(`Invalid status values: ${invalidStatuses.join(', ')}`)
}
if (invalidGateReferences.length > 0) {
  throw new Error(
    `Unresolved gate references: ${invalidGateReferences.join(', ')}`
  )
}

console.log(
  [
    'JSON_PARSE_OK',
    `task=${snapshot.task_id}`,
    `nodes=${snapshot.local_node_allowlist_seed.length}`,
    `forbidden=${snapshot.forbidden_partner_api_nodes.classes.length}`,
    `capabilities=${snapshot.capabilities.length}`,
    `templates=${snapshot.official_workflow_templates.length}`,
    `models=${snapshot.model_sources.length}`,
    `gates=${snapshot.gates.length}`,
    'fingerprints=OK',
    'statuses=OK',
    'gate_refs=OK'
  ].join(' ')
)
