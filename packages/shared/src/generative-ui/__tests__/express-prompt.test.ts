import { describe, expect, it } from "vitest";
import { buildGenerativeUIPrompt } from "../prompt";
import type { GenerativeUIManifest } from "../types";

const manifest: GenerativeUIManifest = {
  catalogId: "demo@1",
  components: {},
  functions: {},
  targets: [{ id: "preview", kind: "inline", description: "Live preview" }],
  surfaces: { form: { target: "preview", dataModel: { name: "user data" } } },
};

describe("Express prompt composition", () => {
  it("uses the supplied language contract without the JSON/tool contract", () => {
    const prompt = buildGenerativeUIPrompt(manifest, {
      format: "express",
      instructions: '<a2ui>\nroot = Text("Hello")\n</a2ui>',
    });
    expect(prompt).toContain('root = Text("Hello")');
    expect(prompt).toContain('"preview"');
    expect(prompt).toContain("Preserve values the user entered");
    expect(prompt).not.toContain("render_ui");
    expect(prompt).not.toContain('"updateComponents"');
    expect(prompt).not.toContain("user data");
  });

  it("keeps the default tool prompt and current surface context", () => {
    const prompt = buildGenerativeUIPrompt(manifest);
    expect(prompt).toContain("render_ui");
    expect(prompt).toContain('"updateComponents"');
    expect(prompt).toContain("user data");
  });
});
