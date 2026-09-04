import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { compileProject } from "../../../packages/workflow/h3-compiler/src/index.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadCapabilityModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-comfy-session-capability-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "comfy-session-capability.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "comfy-session-capability.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function loader(type, widgetName, modelFileName, title = "任意显示标题") {
  return {
    type,
    title,
    widgets_values_named: { [widgetName]: modelFileName }
  };
}

function workflow(unetName = "minimax_h3_ref2va_pruned_int8_convrot.safetensors") {
  return {
    nodes: [
      { type: "MarkdownNote", title: "UNETLoader", widgets_values_named: { unet_name: "fake.safetensors" } }
    ],
    definitions: {
      subgraphs: [{
        nodes: [
          loader("UNETLoader", "unet_name", unetName, "本地化的模型节点"),
          loader("CLIPLoader", "clip_name", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"),
          loader("VAELoader", "vae_name", "minimax_h3_video_vae_fp16.safetensors"),
          loader("VAELoader", "vae_name", "minimax_h3_audio_vae_fp32.safetensors"),
          loader("LoraLoaderModelOnly", "lora_name", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors")
        ]
      }]
    }
  };
}

function combo(values) {
  return [values, { tooltip: "fixture" }];
}

function objectInfo(unetNames = ["minimax_h3_ref2va_pruned_int8_convrot.safetensors"]) {
  return {
    UNETLoader: { input: { required: { unet_name: combo(unetNames) } } },
    CLIPLoader: { input: { required: { clip_name: combo(["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]) } } },
    VAELoader: { input: { required: { vae_name: combo([
      "minimax_h3_video_vae_fp16.safetensors",
      "minimax_h3_audio_vae_fp32.safetensors"
    ]) } } },
    LoraLoaderModelOnly: { input: { required: { lora_name: combo([
      "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
    ]) } } }
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function officialTimedPrompt() {
  return "integrated_multimodal_description: [Shot 1] Live-action, cinematic. The local segment begins.\n\noverall_soundscape: Stable room tone.\n\nnon_diegetic_music: N/A";
}

function officialReferencePrompt() {
  return `subject_definitions:
<Subject 1> is the subject in <Picture 1>.

summary:
[reference generation] Preserve <Subject 1>.

retention_analysis:
<Subject 1>: fully_preserved - identity remains consistent.

detailed_description:
The target video is live-action and cinematic.
[Shot 1] Live-action, cinematic. <Subject 1> remains consistent.

overall_soundscape:
Stable room tone.

non_diegetic_music:
N/A`;
}

function project(mode, samplingProfile, endpoints) {
  return {
    schema_version: "1.0.0",
    prompt: mode === "ref2va" ? officialReferencePrompt() : officialTimedPrompt(),
    mode,
    duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.4,
    advanced: { seed: 1, seed_policy: "fixed", sampling_profile: samplingProfile },
    ...(endpoints === undefined ? {} : { endpoints })
  };
}

function withoutTurboLora(info) {
  const copy = structuredClone(info);
  delete copy.LoraLoaderModelOnly;
  return copy;
}

test("collects exact locked class_type/widget values from nested Comfy workflows", async (context) => {
  const api = await loadCapabilityModule(context);
  const requirements = api.collectRequiredComfyModels(workflow());
  assert.equal(requirements.length, 5);
  assert.deepEqual(requirements.map((item) => [item.classType, item.widgetName, item.modelFileName]), [
    ["CLIPLoader", "clip_name", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"],
    ["LoraLoaderModelOnly", "lora_name", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"],
    ["UNETLoader", "unet_name", "minimax_h3_ref2va_pruned_int8_convrot.safetensors"],
    ["VAELoader", "vae_name", "minimax_h3_audio_vae_fp32.safetensors"],
    ["VAELoader", "vae_name", "minimax_h3_video_vae_fp16.safetensors"]
  ]);
  assert.ok(!requirements.some((item) => item.modelFileName === "fake.safetensors"));
});

test("fixed compiler outputs require only models selected by the official Turbo switch", async (context) => {
  const api = await loadCapabilityModule(context);
  const qualityT2v = await compileProject(project("t2v", "quality_20"));
  const turboT2v = await compileProject(project("t2v", "turbo_8"));
  const qualityFl2va = await compileProject(project(
    "first_frame",
    "quality_20",
    { first_frame: "input/first.png" }
  ));
  const qualityRef2va = await compileProject(project(
    "ref2va",
    "quality_20",
    { reference_images: ["input/reference.png"] }
  ));

  const requirements = (compilation) => api.collectRequiredComfyModels(compilation.workflows[0].workflow);
  const qualityT2vModels = requirements(qualityT2v);
  const turboT2vModels = requirements(turboT2v);
  const qualityFl2vaModels = requirements(qualityFl2va);
  const qualityRef2vaModels = requirements(qualityRef2va);

  assert.equal(qualityT2vModels.length, 4);
  assert.equal(qualityFl2vaModels.length, 4);
  assert.equal(qualityRef2vaModels.length, 4);
  assert.ok(!qualityT2vModels.some((item) => item.classType === "LoraLoaderModelOnly"));
  assert.ok(!qualityFl2vaModels.some((item) => item.classType === "LoraLoaderModelOnly"));
  assert.ok(!qualityRef2vaModels.some((item) => item.classType === "LoraLoaderModelOnly"));
  assert.ok(qualityRef2vaModels.some((item) => (
    item.modelFileName === "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
  )));
  assert.ok(turboT2vModels.some((item) => (
    item.classType === "LoraLoaderModelOnly"
      && item.modelFileName === "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
  )));

  const driftedQuality = structuredClone(qualityT2v.workflows[0].workflow);
  const driftedSubgraph = driftedQuality.definitions.subgraphs[0];
  const driftedLora = driftedSubgraph.nodes.find((node) => node.type === "LoraLoaderModelOnly");
  const driftedConsumer = driftedSubgraph.nodes.find((node) => node.type === "BasicGuider");
  driftedSubgraph.links.push({
    id: 999_999,
    origin_id: driftedLora.id,
    origin_slot: 0,
    target_id: driftedConsumer.id,
    target_slot: 0,
    type: "MODEL"
  });
  assert.ok(requirements({ workflows: [{ workflow: driftedQuality }] }).some((item) => (
    item.classType === "LoraLoaderModelOnly"
  )), "control-flow drift must fail closed by requiring the LoRA");

  await api.assertComfySessionSupportsWorkflow({
    workflow: qualityT2v.workflows[0].workflow,
    fetchImpl: async () => jsonResponse(withoutTurboLora(objectInfo([
      "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
    ])))
  });
  await api.assertComfySessionSupportsWorkflow({
    workflow: qualityRef2va.workflows[0].workflow,
    fetchImpl: async () => jsonResponse(withoutTurboLora(objectInfo()))
  });
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: turboT2v.workflows[0].workflow,
      fetchImpl: async () => jsonResponse(withoutTurboLora(objectInfo([
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
      ])))
    }),
    /LoraLoaderModelOnly\.lora_name.*重启 ComfyUI/u
  );
});

test("root H3 boundary model values are the effective capability requirements", async (context) => {
  const api = await loadCapabilityModule(context);
  const compilation = await compileProject(project("t2v", "quality_20"));
  const workflow = structuredClone(compilation.workflows[0].workflow);
  const subgraphId = workflow.definitions.subgraphs[0].id;
  const call = workflow.nodes.find((node) => node.type === subgraphId);
  call.widgets_values[5] = "other-unet.safetensors";
  call.widgets_values_named.unet_name = "other-unet.safetensors";

  const requirements = api.collectRequiredComfyModels(workflow);
  assert.ok(requirements.some((item) => (
    item.classType === "UNETLoader" && item.modelFileName === "other-unet.safetensors"
  )));
  assert.ok(!requirements.some((item) => (
    item.classType === "UNETLoader"
      && item.modelFileName === "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
  )), "the hidden loader default must not override the effective root call value");

  const longCompilation = await compileProject({
    ...project("t2v", "quality_20"),
    duration: 15,
    segment_duration: 5,
    shot_ids: ["shot-capability01", "shot-capability02", "shot-capability03"],
    prompt: [
      "integrated_multimodal_description: [Shot 1] Live-action opening.",
      "[Shot 2] At 00:05.000, live-action continuation.",
      "[Shot 3] At 00:10.000, live-action conclusion.",
      "",
      "overall_soundscape: Stable room tone.",
      "",
      "non_diegetic_music: N/A",
    ].join("\n"),
  });
  const inconsistent = structuredClone(longCompilation.workflows[0].workflow);
  const longSubgraphId = inconsistent.definitions.subgraphs[0].id;
  const calls = inconsistent.nodes.filter((node) => node.type === longSubgraphId);
  calls[1].widgets_values[5] = "inconsistent-unet.safetensors";
  calls[1].widgets_values_named.unet_name = "inconsistent-unet.safetensors";
  assert.deepEqual(
    api.collectRequiredComfyModels(inconsistent),
    [],
    "inconsistent effective model values across subgraph calls must fail closed",
  );
});

test("linked root Turbo controls fail closed on missing, duplicate, or wrong-type links", async (context) => {
  const api = await loadCapabilityModule(context);
  const compilation = await compileProject(project("t2v", "quality_20"));
  const source = compilation.workflows[0].workflow;
  const subgraphId = source.definitions.subgraphs[0].id;
  const call = source.nodes.find((node) => node.type === subgraphId);
  const targetSlot = call.inputs.findIndex((input) => input.name === "value" && input.type === "BOOLEAN");
  const controlLinkId = call.inputs[targetSlot].link;
  const controlLink = source.links.find((link) => link[0] === controlLinkId);
  const controlNode = source.nodes.find((node) => node.id === controlLink[1]);
  const requiresTurboLora = (candidate) => api.collectRequiredComfyModels(candidate).some((item) => (
    item.classType === "LoraLoaderModelOnly"
  ));

  assert.ok(targetSlot >= 0);
  assert.equal(controlLink[5], "BOOLEAN");
  assert.equal(controlNode.type, "PrimitiveBoolean");

  const missingLink = structuredClone(source);
  missingLink.nodes.find((node) => node.id === call.id).inputs[targetSlot].link = 999_991;
  assert.ok(requiresTurboLora(missingLink), "an unresolved control link must require the Turbo LoRA");

  const duplicateLink = structuredClone(source);
  duplicateLink.links.push([
    999_992,
    controlNode.id,
    0,
    call.id,
    targetSlot,
    "BOOLEAN"
  ]);
  assert.ok(requiresTurboLora(duplicateLink), "multiple links into the Turbo input must be ambiguous");

  const wrongTypeLink = structuredClone(source);
  wrongTypeLink.links.find((link) => link[0] === controlLinkId)[5] = "INT";
  assert.ok(requiresTurboLora(wrongTypeLink), "a non-BOOLEAN Turbo link must not prove quality mode");

  const wrongControlType = structuredClone(source);
  wrongControlType.nodes.find((node) => node.id === controlNode.id).type = "PrimitiveInt";
  assert.ok(requiresTurboLora(wrongControlType), "a non-boolean control node must not prove quality mode");
});

test("certified graph traversal ignores metadata lookalikes and fails closed on compiler budget violations", async (context) => {
  const api = await loadCapabilityModule(context);
  const source = workflow();
  source.metadata = {
    arbitrary: Array.from({ length: 150_000 }, (_, index) => index === 149_999 ? ({
      type: "UNETLoader",
      widgets_values_named: { unet_name: "metadata-lookalike.safetensors" }
    }) : null)
  };
  assert.ok(!api.collectRequiredComfyModels(source).some((item) => (
    item.modelFileName === "metadata-lookalike.safetensors"
  )));

  assert.deepEqual(api.collectRequiredComfyModels({
    nodes: Array.from({ length: 513 }, (_, id) => ({ id, type: "Note" })),
    links: []
  }), []);
  assert.deepEqual(api.collectRequiredComfyModels({
    nodes: [],
    links: [],
    definitions: {
      subgraphs: Array.from({ length: 17 }, (_, index) => ({
        id: `subgraph-${index}`,
        nodes: [],
        links: []
      }))
    }
  }), []);
});

test("proves every required model against the current loopback object_info session", async (context) => {
  const api = await loadCapabilityModule(context);
  const calls = [];
  const requirements = await api.assertComfySessionSupportsWorkflow({
    workflow: workflow(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(objectInfo());
    }
  });
  assert.equal(requirements.length, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8188/object_info");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.body, undefined);
});

test("fails closed with a restart-required Chinese error when Ref2VA is on disk but absent from the live session", async (context) => {
  const api = await loadCapabilityModule(context);
  let launchCalls = 0;
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: workflow(),
      fetchImpl: async () => jsonResponse(objectInfo(["minimax_h3_fl2va_pruned_int8_convrot.safetensors"])),
      launchIfUnavailable: async () => {
        launchCalls += 1;
        return true;
      }
    }),
    (error) => {
      assert.equal(error.code, "INSTALLATION_NOT_READY");
      assert.match(error.message, /当前 ComfyUI 会话尚未识别/u);
      assert.match(error.message, /minimax_h3_ref2va_pruned_int8_convrot\.safetensors/u);
      assert.match(error.message, /重启 ComfyUI/u);
      assert.match(error.message, /没有提交运行任务/u);
      return true;
    }
  );
  assert.equal(launchCalls, 0, "a stale live session must not spawn or replace a process");
});

test("launches only after the initial read and short retry are both unavailable", async (context) => {
  const api = await loadCapabilityModule(context);
  let fetchCalls = 0;
  let launchCalls = 0;
  let delayCalls = 0;
  const requirements = await api.assertComfySessionSupportsWorkflow({
    workflow: workflow(),
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls <= 2) throw new Error("ECONNREFUSED");
      return jsonResponse(objectInfo());
    },
    launchIfUnavailable: async () => {
      launchCalls += 1;
      return true;
    },
    postLaunchAttempts: 1,
    retryDelayMs: 1,
    delayImpl: async () => {
      delayCalls += 1;
    }
  });
  assert.equal(requirements.length, 5);
  assert.equal(fetchCalls, 3);
  assert.equal(launchCalls, 1);
  assert.equal(delayCalls, 2);
});

test("a transient connection failure recovers before any managed-launch callback", async (context) => {
  const api = await loadCapabilityModule(context);
  let fetchCalls = 0;
  let launchCalls = 0;
  let delayCalls = 0;
  const requirements = await api.assertComfySessionSupportsWorkflow({
    workflow: workflow(),
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("fixture: transient ECONNREFUSED");
      return jsonResponse(objectInfo());
    },
    launchIfUnavailable: async () => {
      launchCalls += 1;
      return true;
    },
    attachRetryAttempts: 1,
    retryDelayMs: 1,
    delayImpl: async () => {
      delayCalls += 1;
    }
  });
  assert.equal(requirements.length, 5);
  assert.equal(fetchCalls, 2);
  assert.equal(launchCalls, 0, "one transient read failure must not start or replace ComfyUI");
  assert.equal(delayCalls, 1);
});

test("persistent connection failure and response timeout have distinct bounded diagnostics", async (context) => {
  const api = await loadCapabilityModule(context);
  let unreachableCalls = 0;
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: workflow(),
      fetchImpl: async () => {
        unreachableCalls += 1;
        throw new Error("fixture: ECONNREFUSED");
      },
      launchIfUnavailable: async () => false,
      attachRetryAttempts: 1,
      retryDelayMs: 1,
      delayImpl: async () => undefined
    }),
    (error) => {
      assert.equal(error.code, "INSTALLATION_NOT_READY");
      assert.match(error.message, /COMFY_SESSION_UNREACHABLE/u);
      assert.match(error.message, /127\.0\.0\.1:8188/u);
      assert.doesNotMatch(error.message, /COMFY_SESSION_TIMEOUT/u);
      return true;
    }
  );
  assert.equal(unreachableCalls, 2, "the initial read plus one attach retry stay bounded");

  let timeoutCalls = 0;
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: workflow(),
      fetchImpl: async (_url, init) => {
        timeoutCalls += 1;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new Error("fixture: aborted by request deadline")),
            { once: true }
          );
        });
      },
      launchIfUnavailable: async () => false,
      attachRetryAttempts: 1,
      requestTimeoutMs: 5,
      retryDelayMs: 1,
      delayImpl: async () => undefined
    }),
    (error) => {
      assert.equal(error.code, "INSTALLATION_NOT_READY");
      assert.match(error.message, /COMFY_SESSION_TIMEOUT/u);
      assert.match(error.message, /响应超时/u);
      assert.doesNotMatch(error.message, /COMFY_SESSION_UNREACHABLE/u);
      return true;
    }
  );
  assert.equal(timeoutCalls, 2, "timeouts do not cause an unbounded retry loop");
});

test("malformed capability data, missing node schemas and unprovable workflows all fail closed", async (context) => {
  const api = await loadCapabilityModule(context);
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: workflow(),
      fetchImpl: async () => jsonResponse({ UNETLoader: {} })
    }),
    /未加载工作流要求的官方节点能力.*重启 ComfyUI/u
  );
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: { nodes: [{ type: "Note", title: "UNETLoader" }] },
      fetchImpl: async () => jsonResponse(objectInfo())
    }),
    /没有可验证的官方模型加载器.*重启 ComfyUI/u
  );
  await assert.rejects(
    api.assertComfySessionSupportsWorkflow({
      workflow: workflow(),
      fetchImpl: async () => new Response("[]", { status: 200 })
    }),
    /不兼容的节点能力信息.*重启 ComfyUI/u
  );
});

test("HTTP 200 invalid JSON and malformed or oversized streaming bodies never trigger a launch", async (context) => {
  const api = await loadCapabilityModule(context);
  let launchCalls = 0;
  const launchIfUnavailable = async () => {
    launchCalls += 1;
    return true;
  };
  for (const response of [
    new Response("temporarily unavailable", { status: 503 }),
    new Response("not-json", { status: 200 }),
    new Response("{}", { status: 200, headers: { "content-length": "not-a-number" } }),
    new Response("{}", { status: 200, headers: { "content-length": "67108865" } }),
    new Response(new ReadableStream({
      start(controller) {
        const chunk = new Uint8Array(1024 * 1024);
        for (let index = 0; index < 65; index += 1) controller.enqueue(chunk);
        controller.close();
      }
    }), { status: 200 })
  ]) {
    await assert.rejects(
      api.assertComfySessionSupportsWorkflow({
        workflow: workflow(),
        fetchImpl: async () => response,
        launchIfUnavailable
      }),
      /COMFY_SESSION_PROTOCOL_INVALID.*无效或不兼容的节点能力信息.*重启 ComfyUI/u
    );
  }
  assert.equal(launchCalls, 0);
});

test("API-format class_type graphs are supported without display-name inference", async (context) => {
  const api = await loadCapabilityModule(context);
  const requirements = api.collectRequiredComfyModels({
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors" },
      _meta: { title: "任意名称" }
    }
  });
  assert.deepEqual(requirements, [{
    classType: "UNETLoader",
    widgetName: "unet_name",
    modelFileName: "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
  }]);
});

test("the production service proves the live session before project-authority or legacy handoff", async () => {
  const source = await readFile(
    path.join(projectRoot, "src", "main", "services", "index.ts"),
    "utf8"
  );
  const capabilityCall = source.indexOf("await assertComfySessionSupportsWorkflow");
  const authorityCall = source.indexOf("projectAuthority = await storeAndHandoffProjectWorkflow", capabilityCall);
  const authorityGate = source.indexOf("validated.projectId !== undefined && validated.projectId !== null", capabilityCall);
  const legacyExportCall = source.indexOf("await exportDeterministicWorkflow", capabilityCall);
  const legacyStoreGate = source.indexOf("compiledWorkflow !== null && projectAuthority === null", capabilityCall);
  const legacyStoreCall = source.indexOf("await storeWorkflowInComfyLibrary", capabilityCall);
  const visibleCall = source.indexOf("await showWorkflowInComfyWindow", capabilityCall);
  assert.ok(capabilityCall > 0);
  assert.ok(authorityGate > capabilityCall, "project authority is gated only after the live-session proof");
  assert.ok(authorityCall > authorityGate, "project workflow authority is written inside the project branch");
  assert.ok(legacyExportCall > authorityCall, "the alternate legacy export branch follows the authority branch");
  assert.ok(legacyStoreGate > legacyExportCall, "legacy library storage is explicitly excluded after authority handoff");
  assert.ok(legacyStoreCall > legacyStoreGate, "legacy export is stored only through the legacy gate");
  assert.ok(visibleCall > legacyStoreCall, "both branches converge on visible handoff last");
  assert.doesNotMatch(
    source,
    /\/prompt\b|queuePrompt|submitQueue|submit[_-]?(?:graph|queue|job)|(?:run|queue)[_-]?(?:workflow|job)\s*\(/iu
  );
});
