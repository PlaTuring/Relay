import type {
  ComponentId,
  ComponentScanResult
} from "../../shared/ipc-contract.js";

export type A3InstallationComponent =
  | "comfy-portable"
  | "comfy-desktop"
  | "ffmpeg-managed"
  | "fl2va-base"
  | "ref2va-addon"
  | "fl2v-turbo"
  | "ref2v-turbo";

const COMPONENT_ORDER = Object.freeze<ComponentId[]>([
  "fl2va_base",
  "pyav_required",
  "comfyui_desktop_optional",
  "turbo_acceleration_recommended",
  "ref2va_optional",
  "ffmpeg_long_video_optional"
]);

const REQUIRED_COMPONENT_ORDER = Object.freeze<ComponentId[]>([
  "fl2va_base",
  "pyav_required",
  "comfyui_desktop_optional"
]);

const SELECTABLE_OPTIONAL_COMPONENT_ORDER = Object.freeze<ComponentId[]>([
  "turbo_acceleration_recommended",
  "ref2va_optional",
  "ffmpeg_long_video_optional"
]);

const COMPONENT_RANK = new Map<ComponentId, number>(
  COMPONENT_ORDER.map((component, index) => [component, index])
);
const REQUIRED_COMPONENTS = new Set<ComponentId>(REQUIRED_COMPONENT_ORDER);
const SELECTABLE_OPTIONAL_COMPONENTS = new Set<ComponentId>(SELECTABLE_OPTIONAL_COMPONENT_ORDER);

export const SELECTABLE_OPTIONAL_COMPONENT_COUNT = SELECTABLE_OPTIONAL_COMPONENT_ORDER.length;

export function isSelectableOptionalComponent(value: unknown): value is ComponentId {
  return typeof value === "string" && SELECTABLE_OPTIONAL_COMPONENTS.has(value as ComponentId);
}

function requireSelectableOptionalComponents(
  selectedOptionalComponents: readonly ComponentId[]
): ReadonlySet<ComponentId> {
  if (
    !Array.isArray(selectedOptionalComponents) ||
    selectedOptionalComponents.length > SELECTABLE_OPTIONAL_COMPONENT_COUNT ||
    selectedOptionalComponents.some((component) => !isSelectableOptionalComponent(component)) ||
    new Set(selectedOptionalComponents).size !== selectedOptionalComponents.length
  ) {
    throw new TypeError("Installation optional-component selection is invalid.");
  }
  return new Set(selectedOptionalComponents);
}

/**
 * Enforces the installation UI/backend invariant at the trust boundary.  All
 * required rows are selected and precede optional rows, independent of the
 * order or flags returned by a scan adapter.
 */
export function normalizeInstallationComponents(
  components: readonly ComponentScanResult[]
): readonly ComponentScanResult[] {
  const ids = components.map((component) => component.id);
  if (
    components.length !== COMPONENT_ORDER.length ||
    new Set(ids).size !== COMPONENT_ORDER.length ||
    COMPONENT_ORDER.some((component) => !ids.includes(component))
  ) {
    throw new TypeError("Installation component scan is incomplete or duplicated.");
  }

  return Object.freeze(components
    .map((component) => {
      const required = REQUIRED_COMPONENTS.has(component.id);
      return Object.freeze({
        ...component,
        required,
        selected: required || component.selected
      });
    })
    .sort((left, right) =>
      (COMPONENT_RANK.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (COMPONENT_RANK.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
}

/** Required public capabilities cannot be removed by a renderer request. */
export function selectedPublicInstallationComponents(
  selectedOptionalComponents: readonly ComponentId[]
): readonly ComponentId[] {
  const selected = requireSelectableOptionalComponents(selectedOptionalComponents);
  return Object.freeze([
    ...REQUIRED_COMPONENT_ORDER,
    ...SELECTABLE_OPTIONAL_COMPONENT_ORDER.filter((component) => selected.has(component))
  ]);
}

/**
 * Existing ComfyUI remains attach-only.  Without an attachable environment,
 * Relay provisions its pinned Portable runtime and the required, verified
 * Desktop installer; neither path mutates an external ComfyUI instance.
 */
export function resolveA3InstallationComponents(input: {
  readonly hasAttachedComfyUi: boolean;
  readonly selectedOptionalComponents: readonly ComponentId[];
}): readonly A3InstallationComponent[] {
  const selected = requireSelectableOptionalComponents(input.selectedOptionalComponents);
  const components: A3InstallationComponent[] = input.hasAttachedComfyUi
    ? ["fl2va-base"]
    : ["comfy-portable", "comfy-desktop", "fl2va-base"];

  if (selected.has("turbo_acceleration_recommended")) components.push("fl2v-turbo");
  if (selected.has("ref2va_optional")) components.push("ref2va-addon");
  // Keep the legacy ref2v-turbo component ID readable for old installation
  // manifests, but never include it in a new plan.  The certified Ref2VA
  // compiler accepts the 20/25-step quality paths only; the independently
  // selected Turbo package is the FL2VA/T2V 8-step LoRA.
  if (selected.has("ffmpeg_long_video_optional")) components.push("ffmpeg-managed");
  return Object.freeze(components);
}
