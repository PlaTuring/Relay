import { rejected, unavailable } from "./failure.ts";
import { observeAmbientFfmpegPresence } from "./ffmpeg.ts";
import { probePrivateFfmpeg } from "./private-pair.ts";
import { observeExternalPyAvIdentity, probeManagedPyAv } from "./pyav.ts";
import { compareOrdinal } from "./safe-text.ts";
import type {
  ManagedPyAvProbeDependencies,
  ManagedPyAvTarget,
  MediaCapabilityReport,
  PrivateProbeDependencies,
  PyAvObservation
} from "./types.ts";

export interface MediaCapabilityProbeRequest {
  readonly managedPyAv?: ManagedPyAvTarget;
  readonly externalPyAvIdentity?: unknown;
  readonly privateFfmpegPair?: unknown;
  readonly ambientFfmpegPresent: boolean;
}

export interface MediaCapabilityProbeDependencies {
  readonly managedPyAv?: ManagedPyAvProbeDependencies;
  readonly privateFfmpeg?: PrivateProbeDependencies;
}

function sourceKey(value: PyAvObservation): string {
  if ("source" in value) return value.source;
  return `zz-${value.failure.code}`;
}

export async function probeMediaCapabilities(
  request: MediaCapabilityProbeRequest,
  dependencies: MediaCapabilityProbeDependencies = {}
): Promise<MediaCapabilityReport> {
  try {
    if (
      typeof request !== "object" ||
      request === null ||
      typeof request.ambientFfmpegPresent !== "boolean"
    ) {
      return Object.freeze({
        schemaVersion: 1,
        pyav: Object.freeze([rejected("MEDIA.INVALID_REQUEST")]),
        privateFfmpeg: rejected("MEDIA.INVALID_REQUEST"),
        ambientFfmpeg: rejected("MEDIA.INVALID_REQUEST")
      });
    }

    const pyav: PyAvObservation[] = [];
    if (request.externalPyAvIdentity !== undefined) {
      try {
        pyav.push(observeExternalPyAvIdentity(request.externalPyAvIdentity));
      } catch {
        pyav.push(rejected("MEDIA.OUTPUT_INVALID"));
      }
    }
    if (request.managedPyAv !== undefined) {
      pyav.push(
        dependencies.managedPyAv
          ? await probeManagedPyAv(request.managedPyAv, dependencies.managedPyAv)
          : rejected("MEDIA.PYAV_RUNTIME_UNVERIFIED")
      );
    }
    if (pyav.length === 0) pyav.push(unavailable("MEDIA.PROBE_UNAVAILABLE"));
    pyav.sort((left, right) => compareOrdinal(sourceKey(left), sourceKey(right)));

    const privateFfmpeg = request.privateFfmpegPair === undefined
      ? unavailable("MEDIA.PROBE_UNAVAILABLE")
      : dependencies.privateFfmpeg
        ? await probePrivateFfmpeg(request.privateFfmpegPair, dependencies.privateFfmpeg)
        : rejected("MEDIA.CATALOG_PROOF_MISSING");

    return Object.freeze({
      schemaVersion: 1,
      pyav: Object.freeze(pyav),
      privateFfmpeg,
      ambientFfmpeg: observeAmbientFfmpegPresence(request.ambientFfmpegPresent)
    });
  } catch {
    return Object.freeze({
      schemaVersion: 1,
      pyav: Object.freeze([rejected("MEDIA.INVALID_REQUEST")]),
      privateFfmpeg: rejected("MEDIA.INVALID_REQUEST"),
      ambientFfmpeg: rejected("MEDIA.INVALID_REQUEST")
    });
  }
}
