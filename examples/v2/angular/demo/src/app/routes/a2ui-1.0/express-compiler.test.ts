import { describe, expect, it } from "vitest";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import { createExpressCompiler, EXPRESS_PRESETS } from "./express-compiler";
import { testManifest, testUI } from "./test-catalog";

describe("the official Express compiler with a CopilotKit catalog", () => {
  it("compiles the form with a two-way binding and an agent event", async () => {
    const compiler = await createExpressCompiler(exportA2UICatalog(testUI));
    const operations = compiler.compile(
      EXPRESS_PRESETS.form,
      "form",
      testManifest,
    );
    const json = JSON.stringify(operations);
    expect(json).toContain('"version":"v1.0"');
    expect(json).toContain('"@path":"/name"');
    expect(json).toContain('"name":"plan_trip"');
    expect(json).toContain('"surfaceId":"form"');
    const prompt = compiler.systemPrompt(testManifest);
    expect(prompt).toContain("A2UI Express");
    expect(prompt).toContain("TextField(");
    expect(prompt).toContain("Plan your next adventure");
    expect(prompt).not.toContain("render_ui");
  });

  it("compiles a targeted update without creating another surface", async () => {
    const compiler = await createExpressCompiler(exportA2UICatalog(testUI));
    const operations = compiler.compile(
      'surface("form", update=true)\n$/status = "Done"',
      "unused",
      {
        ...testManifest,
        surfaces: { form: { target: "express-preview" } },
      },
    );
    expect(operations).toEqual([
      {
        version: "v1.0",
        updateDataModel: { surfaceId: "form", path: "/status", value: "Done" },
      },
    ]);
  });

  it("rejects malformed and unknown components instead of rendering partial output", async () => {
    const compiler = await createExpressCompiler(exportA2UICatalog(testUI));
    expect(() =>
      compiler.compile('root = Evil("run code")', "bad", testManifest),
    ).toThrow();
    expect(() =>
      compiler.compile('<a2ui>root = Text("unfinished")', "bad", testManifest),
    ).toThrow(/Finish/);
    expect(() =>
      compiler.compile(
        'surface("missing", update=true)\n$/status="x"',
        "bad",
        testManifest,
      ),
    ).toThrow(/does not exist/);
  });
});
