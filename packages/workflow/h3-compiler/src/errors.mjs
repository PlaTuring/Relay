export class CompilerError extends Error {
  constructor(code, message, instancePath = "/") {
    super(message);
    this.name = "CompilerError";
    this.code = code;
    this.instancePath = instancePath;
  }
}

export function fail(code, message, instancePath = "/") {
  throw new CompilerError(code, message, instancePath);
}

const PUBLIC_PROMPT_REASONS = new Map([
  ["Prompt fields are duplicated or unsupported.", "PROMPT_FIELDS_DUPLICATED_OR_UNSUPPORTED"],
  ["Prompt fields other than soundscape and music must not be empty.", "PROMPT_REQUIRED_FIELD_EMPTY"],
  ["Prompt fields do not match the selected H3 mode.", "PROMPT_MODE_FIELDS_MISMATCH"],
  ["Prompt fields are not in official order.", "PROMPT_FIELD_ORDER"],
  ["The selected H3 mode is missing its official timeline field.", "PROMPT_TIMELINE_FIELD_MISSING"],
  ["Base H3 requires the official three-section prompt format.", "BASE_THREE_FIELDS_REQUIRED"],
  ["Ref2VA requires the official six-section prompt format.", "REF2VA_SIX_FIELDS_REQUIRED"],
  ["Ref2VA must begin with subject_definitions.", "REF2VA_SUBJECT_DEFINITIONS_FIRST"],
  ["T2V must begin with integrated_multimodal_description.", "T2V_DESCRIPTION_FIRST"],
  ["Keyframe prompt preamble is not an image-alignment instruction.", "KEYFRAME_PREAMBLE_INVALID"],
  ["Base-mode timeline must begin with [Shot 1] or [镜头 1].", "BASE_SHOT_ONE_FIRST"],
  ["Every shot must contain a description.", "SHOT_DESCRIPTION_EMPTY"],
  ["Shot numbers must begin at 1 and remain consecutive.", "SHOT_NUMBER_SEQUENCE"],
  ["Ref2VA summary must begin with official English task types.", "REF2VA_SUMMARY_TASK_TYPE"],
  ["Every Ref2VA retention line must use an official relationship marker.", "REF2VA_RETENTION_RELATIONSHIP"],
  ["Ref2VA detailed_description requires a style opening before [Shot 1].", "REF2VA_STYLE_OPENING"],
  ["Ref2VA subject_definitions must define at least one reference label.", "REF2VA_REFERENCE_LABEL_REQUIRED"]
]);

export function publicError(error) {
  if (error instanceof CompilerError) {
    const reason = PUBLIC_PROMPT_REASONS.get(error.message);
    return Object.freeze(reason === undefined
      ? { code: error.code, instance_path: error.instancePath }
      : { code: error.code, instance_path: error.instancePath, reason });
  }
  return Object.freeze({ code: "COMPILER.INTERNAL", instance_path: "/" });
}
