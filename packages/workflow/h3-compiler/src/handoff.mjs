import {
  COMPILER_VERSION,
  OFFICIAL_FIXED_CAPABILITIES,
  resolveCanvasSize,
  SAMPLING_PROFILE_STEPS,
  TEMPLATE_REVISION,
} from "./constants.mjs";
import { fail } from "./errors.mjs";

function executionModelSettings(workflow) {
  const exposedCalls = workflow.nodes.filter((node) => (
    typeof node.widgets_values_named?.unet_name === "string"
    && typeof node.widgets_values_named?.clip_name === "string"
    && typeof node.widgets_values_named?.vae_name === "string"
    && typeof node.widgets_values_named?.vae_name_1 === "string"
  ));
  if (exposedCalls.length > 0) {
    const first = exposedCalls[0].widgets_values_named;
    if (exposedCalls.some((node) => (
      node.widgets_values_named.unet_name !== first.unet_name
      || node.widgets_values_named.clip_name !== first.clip_name
      || node.widgets_values_named.vae_name !== first.vae_name
      || node.widgets_values_named.vae_name_1 !== first.vae_name_1
    ))) {
      fail("HANDOFF.MODEL_SETTINGS", "H3 call model settings are inconsistent.", "/handoff");
    }
    return Object.freeze({
      unet: first.unet_name,
      clip: first.clip_name,
      video_vae: first.vae_name,
      audio_vae: first.vae_name_1,
    });
  }

  const typed = (type) => workflow.nodes.filter((node) => node.type === type);
  const unets = typed("UNETLoader");
  const clips = typed("CLIPLoader");
  const vaes = typed("VAELoader");
  const videoVaes = vaes.filter((node) => /(?:^|_)video_vae(?:_|\.)/iu.test(node.widgets_values_named?.vae_name ?? ""));
  const audioVaes = vaes.filter((node) => /(?:^|_)audio_vae(?:_|\.)/iu.test(node.widgets_values_named?.vae_name ?? ""));
  if (unets.length !== 1 || clips.length !== 1 || videoVaes.length !== 1 || audioVaes.length !== 1) {
    fail("HANDOFF.MODEL_SETTINGS", "Pinned H3 model settings are absent or ambiguous.", "/handoff");
  }
  return Object.freeze({
    unet: unets[0].widgets_values_named.unet_name,
    clip: clips[0].widgets_values_named.clip_name,
    video_vae: videoVaes[0].widgets_values_named.vae_name,
    audio_vae: audioVaes[0].widgets_values_named.vae_name,
  });
}

function turboSettings(workflow, samplingProfile) {
  if (samplingProfile !== "turbo_8") {
    const activeCalls = workflow.nodes.filter((node) => node.widgets_values_named?.value === true
      && typeof node.widgets_values_named?.lora_name === "string");
    if (activeCalls.length > 0) {
      fail("HANDOFF.TURBO_SETTINGS", "Inactive Turbo profile has an active Turbo call.", "/handoff");
    }
    return Object.freeze({ enabled: false, lora: null, strength: null, steps: null });
  }
  const calls = workflow.nodes.filter((node) => node.widgets_values_named?.value === true
    && typeof node.widgets_values_named?.lora_name === "string");
  if (calls.length < 1 || calls.some((node) => (
    node.widgets_values_named.lora_name !== calls[0].widgets_values_named.lora_name
    || node.widgets_values_named.strength_model_1 !== OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength
    || node.widgets_values_named.value_2 !== OFFICIAL_FIXED_CAPABILITIES.turbo_steps
  ))) {
    fail("HANDOFF.TURBO_SETTINGS", "Active Turbo settings are absent or inconsistent.", "/handoff");
  }
  return Object.freeze({
    enabled: true,
    lora: calls[0].widgets_values_named.lora_name,
    strength: OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength,
    steps: OFFICIAL_FIXED_CAPABILITIES.turbo_steps,
  });
}

export function publicSegmentPlan(compilation) {
  const emittedDuration = compilation.plan.single_workflow_dag
    ? compilation.plan.total_duration
    : compilation.workflows.reduce((total, item) => total + item.segment.duration, 0);
  return Object.freeze({
    contract_id: "minimax-h3-tool.segment-plan",
    schema_version: "1.0.0",
    status: compilation.plan.status,
    block_code: compilation.plan.block_code ?? null,
    warning_code: compilation.plan.warning_code ?? null,
    warning: compilation.plan.warning ?? null,
    experimental: compilation.plan.experimental,
    requested_duration_seconds: compilation.plan.total_duration,
    emitted_duration_seconds: emittedDuration,
    segment_duration_seconds: compilation.plan.segment_duration,
    requested_segment_duration_seconds: compilation.plan.requested_segment_duration,
    transitions: compilation.plan.transitions,
    planned_segment_count: compilation.plan.segment_count,
    emitted_segment_count: compilation.plan.emitted_segment_count,
    emitted_workflow_count: compilation.workflows.length,
    single_workflow_dag: compilation.plan.single_workflow_dag,
    continuity: compilation.plan.continuity,
    automatic_execution: false,
    automatic_assembly: false,
    assembly_after_manual_run: compilation.plan.assembly_after_manual_run,
    assembly_owner: compilation.plan.assembly_owner,
    segments: compilation.plan.segments.map((segment) => Object.freeze({
      index: segment.index,
      name: segment.name,
      duration_seconds: segment.duration,
      generated_frames: segment.generated_frames,
      mode: segment.mode,
      workflow_status: segment.workflow_status,
      transition_from_previous: segment.transition_from_previous,
      requires_previous_segment_final_frame: segment.requires_previous_segment_final_frame,
      planned_output_prefix: segment.planned_output_prefix,
      planned_workflow_file: segment.planned_workflow_file,
      output_role: segment.output_role,
      continuity_source: segment.continuity_source ?? null,
    })),
  });
}

export function createHandoffWorkflow(compilation) {
  if (!compilation || !Array.isArray(compilation.workflows) || compilation.workflows.length !== 1) {
    fail("HANDOFF.WORKFLOW_COUNT", "A visible handoff must contain exactly one safely emitted workflow.", "/handoff");
  }
  if (compilation.plan?.status === "experimental_blocked") {
    fail(
      "HANDOFF.BLOCKED_SEGMENT_PLAN",
      "The requested long-video mode cannot yet be represented as one complete safe workflow.",
      "/segment_plan",
    );
  }
  const workflow = structuredClone(compilation.workflows[0].workflow);
  if (!workflow.extra || typeof workflow.extra !== "object" || Array.isArray(workflow.extra)) workflow.extra = {};
  const resolvedCanvas = resolveCanvasSize(compilation.project.canvas, compilation.project.resolution_megapixels);
  const models = executionModelSettings(workflow);
  const turbo = turboSettings(workflow, compilation.project.advanced.sampling_profile);
  workflow.extra.minimax_h3_tool = {
    compiler_version: COMPILER_VERSION,
    template_revision: TEMPLATE_REVISION,
    capability: "EDITABLE_VISUAL_WORKFLOW_EXPORT_ONLY",
    generation_owner: "minimax_h3_inside_comfyui_after_user_clicks_run",
    queue_submission: false,
    automatic_execution: false,
    software_brand_only: true,
    media_branding_authority: false,
    output_attribution: compilation.output_attribution ?? null,
    official_settings: {
      mode: compilation.project.mode,
      canvas: compilation.project.canvas,
      resolution_megapixels: compilation.project.resolution_megapixels,
      resolved_width: resolvedCanvas.width,
      resolved_height: resolvedCanvas.height,
      total_duration_seconds: compilation.project.duration,
      segment_durations_seconds: compilation.plan.segment_durations,
      seed: compilation.seed_plan.base_seed,
      base_seed: compilation.seed_plan.base_seed,
      seed_policy: compilation.seed_plan.policy,
      node_control_after_generate: compilation.seed_plan.node_control_after_generate,
      shot_seeds: compilation.seed_plan.shots,
      sampling_profile: compilation.project.advanced.sampling_profile,
      active_steps: SAMPLING_PROFILE_STEPS[compilation.project.advanced.sampling_profile],
      turbo_enabled: turbo.enabled,
      turbo_lora: turbo.lora,
      turbo_model_strength: turbo.strength,
      turbo_steps: turbo.steps,
      models,
      sampler: OFFICIAL_FIXED_CAPABILITIES.sampler,
      scheduler: OFFICIAL_FIXED_CAPABILITIES.scheduler,
      denoise: OFFICIAL_FIXED_CAPABILITIES.denoise,
      fps: OFFICIAL_FIXED_CAPABILITIES.fps,
      audio: OFFICIAL_FIXED_CAPABILITIES.audio,
      native_audio: true,
      guidance: OFFICIAL_FIXED_CAPABILITIES.guidance,
    },
    segment_plan: publicSegmentPlan(compilation),
  };
  return workflow;
}
