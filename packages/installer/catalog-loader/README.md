# Embedded catalog loader

This package is a data-only trust-boundary consumer for the single component catalog embedded in the current application build. It performs no file-system, network, process, download, materialization, installation, deletion, launch, queue, ComfyUI, GPU, Python, custom-node or media operation.

MiniMax H3, invoked inside ComfyUI after the user clicks Run, is the only component that generates video and native audio.

## API

`createEmbeddedCatalogLoader(configuration)` accepts exactly:

- `current_app`: the exact `app_id`, SemVer `app_version` and immutable `app_build_id` compiled into the current app;
- `trusted_inventory_keys`: a bounded non-empty array of app-trusted Ed25519 public keys. Each key has `key_id`, `algorithm: "ed25519"` and canonical SPKI DER bytes.

The trust keys are configuration owned by the privileged application packaging/integration boundary. They must not be read from, or selected by, the signed inventory. DER is size-bounded before copying or parsing and must byte-match Node's canonical SPKI re-export, preventing parseable trailing-byte aliases.

`loader.load(request)` accepts exactly:

- `signed_build_inventory`: canonical JCS UTF-8 bytes for the package-local signed inventory envelope;
- `embedded_resource_index`: a complete index supplied by the application packaging adapter.

The resource index must declare `kind: "complete_current_app_embedded_resource_index"`. Its `resources` may contain unrelated resources with role `other_embedded_resource`, but must contain exactly one `component_catalog` entry carrying embedded bytes. Duplicate resource names, ASCII case aliases under the package-local simple ordinal fold and additional catalog candidates fail closed. The pure loader can validate only the entries it receives: proving that the index exhaustively enumerates the packaged app resources is an application adapter and packaging-test obligation. The loader does not claim to call the Windows `CompareStringOrdinal` API for arbitrary Unicode resource names.

The signed inventory uses a closed canonical envelope:

```text
{
  envelope_version: "1.0.0",
  payload: {
    contract_id: "minimax-h3-tool.signed-build-inventory-catalog-binding",
    schema_version: "1.0.0",
    inventory_id,
    disposition: { kind: "active" },
    signing: { algorithm: "ed25519", key_id },
    current_app: { app_id, app_version, app_build_id, artifact_status: "current_app_build" },
    catalog_bindings: [{
      kind: "component_manifest",
      status: "active",
      app_id,
      app_version,
      app_build_id,
      catalog_resource,
      content_sha256
    }]
  },
  signature: { algorithm: "ed25519", key_id, encoding: "base64", value }
}
```

The detached Ed25519 signature covers the exact JCS encoding of `payload`. The envelope itself must also arrive as exact JCS bytes. A self-declared verification flag, a public key inside the envelope, unknown fields, remote discovery/override/fallback options, network catalog locators, mutable names such as `latest`, and inactive status are rejected.

On success, `load` returns a deeply frozen `lazy_embedded_component_catalog_data` handle. It exposes metadata and read-only lookup/iteration methods for component and license-record data. It grants no action authority. In particular, an immutable revision-pinned HTTPS artifact locator remains inert catalog metadata; it is not fetched or approved by this loader.

## Validation and errors

Catalog validation is ordered as raw-size/UTF-8/strict parse, envelope/version, logical JCS integrity, exact accepted schema, domain invariants, dependency/actionability closure, then current-app/inventory/catalog cross-binding. The current loader additionally requires an active manifest even though the shared contract can represent revoked or superseded evidence.

Strict JSON parsing rejects a BOM, malformed UTF-8, duplicate keys, floats/exponents, negative zero, unsafe integers, lone surrogates and exceeded ADR-004 ceilings before downstream validation. Catalog integrity is SHA-256 over RFC 8785 JCS with the entire root `integrity` property omitted; it is not a raw-resource byte hash.

Failures are `CatalogLoaderError` objects with stable `code`, `stage`, `instance_path` and `rule_id` fields. `byte_offset` is present only when the parser knows an exact offset. Errors do not echo input values or private paths.
