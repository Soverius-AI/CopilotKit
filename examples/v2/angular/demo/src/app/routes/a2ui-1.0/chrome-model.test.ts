import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeModel } from "./chrome-model";

afterEach(() => vi.unstubAllGlobals());

describe("Chrome Prompt API adapter", () => {
  it("detects unsupported browsers without attempting a download", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const model = new ChromeModel();
    expect(await model.availability()).toBe("unsupported");
    await expect(
      model.enable("system", new AbortController().signal, () => {}),
    ).rejects.toThrow(/not available/);
  });

  it("uses matching language options and destroys each per-run clone", async () => {
    const destroyClone = vi.fn();
    const destroyBase = vi.fn();
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("root = Text");
        controller.enqueue('("Hello")');
        controller.close();
      },
    });
    const promptStreaming = vi.fn(() => stream);
    const availability = vi.fn(async () => "available");
    const create = vi.fn(async () => ({
      clone: async () => ({ promptStreaming, destroy: destroyClone }),
      destroy: destroyBase,
    }));
    vi.stubGlobal("LanguageModel", { availability, create });
    const model = new ChromeModel();
    const signal = new AbortController().signal;
    await model.availability();
    await model.enable("Express examples", signal, () => {});
    let output = "";
    for await (const chunk of model.generate(
      "request",
      "Express examples",
      signal,
    ))
      output += chunk;
    expect(output).toBe('root = Text("Hello")');
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      ...availability.mock.calls[0]?.[0],
      initialPrompts: [{ role: "system", content: "Express examples" }],
    });
    expect(promptStreaming).toHaveBeenCalledWith("request", { signal });
    expect(destroyClone).toHaveBeenCalledOnce();
    model.destroy();
    expect(destroyBase).toHaveBeenCalledOnce();
  });
});
