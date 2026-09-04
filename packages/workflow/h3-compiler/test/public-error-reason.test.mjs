import assert from "node:assert/strict";
import test from "node:test";

import { CompilerError, publicError } from "../src/errors.mjs";

test("public compiler errors expose only a finite prompt reason code", () => {
  assert.deepEqual(
    publicError(new CompilerError(
      "PROJECT.PROMPT_FORMAT",
      "Ref2VA detailed_description requires a style opening before [Shot 1].",
      "/prompt",
    )),
    {
      code: "PROJECT.PROMPT_FORMAT",
      instance_path: "/prompt",
      reason: "REF2VA_STYLE_OPENING",
    },
  );
  assert.deepEqual(
    publicError(new CompilerError("PROJECT.SECRET", "opaque user-derived detail", "/prompt")),
    { code: "PROJECT.SECRET", instance_path: "/prompt" },
  );
});
