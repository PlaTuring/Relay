import type { MediaFailureCode, SafeFailure } from "./types.ts";

const summaries: Readonly<Record<MediaFailureCode, string>> = Object.freeze({
  "MEDIA.INVALID_REQUEST": "The probe request did not match the closed capability contract.",
  "MEDIA.EXECUTABLE_NOT_ABSOLUTE": "The executable was not supplied by absolute path.",
  "MEDIA.PROCESS_SPAWN_FAILED": "The bounded probe process could not be started.",
  "MEDIA.PROCESS_NONZERO": "The probe process did not complete successfully.",
  "MEDIA.PROCESS_TIMEOUT": "The probe process exceeded its time limit.",
  "MEDIA.PROCESS_OUTPUT_LIMIT": "The probe process exceeded its output limit.",
  "MEDIA.PROCESS_TREE_UNCONFIRMED": "The probe process tree could not be proven closed.",
  "MEDIA.OUTPUT_INVALID_UTF8": "The probe emitted invalid UTF-8.",
  "MEDIA.OUTPUT_UNSAFE_TEXT": "The probe emitted unsafe control or terminal text.",
  "MEDIA.OUTPUT_INVALID": "The probe emitted malformed or conflicting capability data.",
  "MEDIA.PYAV_RUNTIME_UNVERIFIED": "The PyAV runtime was not verified as tool-managed.",
  "MEDIA.PYAV_CONFLICT": "The PyAV capability identity contained a conflict.",
  "MEDIA.CATALOG_PROOF_MISSING": "The private tools were not bound to the verified packaged catalog and build.",
  "MEDIA.ARTIFACT_MISMATCH": "A private tool artifact did not match its exact manifest identity.",
  "MEDIA.SIGNATURE_PROOF_MISSING": "A private tool lacked matching Authenticode verification proof.",
  "MEDIA.OWNERSHIP_PROOF_MISSING": "A private tool lacked current matching ownership and handle-containment proof.",
  "MEDIA.EXACT_IMAGE_PROOF_MISSING": "A probe process image did not match the verified private artifact.",
  "MEDIA.FFMPEG_PAIR_CONFLICT": "FFmpeg and FFprobe did not describe one coherent build.",
  "MEDIA.PROBE_UNAVAILABLE": "No capability target was supplied."
});

export function failure(code: MediaFailureCode): SafeFailure {
  return Object.freeze({ code, summary: summaries[code] });
}

export function unavailable(code: MediaFailureCode): Readonly<{
  status: "unavailable";
  selectable: false;
  selected: false;
  failure: SafeFailure;
}> {
  return Object.freeze({
    status: "unavailable",
    selectable: false,
    selected: false,
    failure: failure(code)
  });
}

export function rejected(code: MediaFailureCode): Readonly<{
  status: "rejected";
  selectable: false;
  selected: false;
  failure: SafeFailure;
}> {
  return Object.freeze({
    status: "rejected",
    selectable: false,
    selected: false,
    failure: failure(code)
  });
}
