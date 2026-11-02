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
    const stream = () =>
      new ReadableStream<string>({
        start(controller) {
          controller.enqueue("root = Text");
          controller.enqueue('("Hello")');
          controller.close();
        },
      });
    const promptStreaming = vi.fn((_input: unknown, _options: unknown) =>
      stream(),
    );
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
    expect(promptStreaming).toHaveBeenCalledWith(
      [{ role: "user", content: "request" }],
      { signal },
    );
    expect(destroyClone).toHaveBeenCalledOnce();
    for await (const _ of model.generate(
      JSON.stringify({
        conversation: [
          { role: "user", content: "Create a checkout" },
          { role: "assistant", content: "Rejected Express" },
          { role: "user", content: "Repair this compiler error" },
        ],
        surfaces: { checkout: { target: "express-preview" } },
      }),
      "Express examples",
      signal,
    )) {
      /* Drain the real adapter stream. */
    }
    expect(promptStreaming.mock.calls[1]?.[0]).toEqual([
      { role: "user", content: "Create a checkout" },
      { role: "assistant", content: "Rejected Express" },
      {
        role: "user",
        content: expect.stringContaining(
          "Current user request:\nRepair this compiler error",
        ),
      },
    ]);
    expect(destroyClone).toHaveBeenCalledTimes(2);
    model.destroy();
    expect(destroyBase).toHaveBeenCalledOnce();
  });
});
