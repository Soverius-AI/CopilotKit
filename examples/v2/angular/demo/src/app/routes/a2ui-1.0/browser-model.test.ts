import { describe, expect, it, vi } from "vitest";
import { BrowserModel } from "./browser-model";
import type { LocalModel } from "./browser-model";

function model(
  backend: "chrome" | "transformers",
  availability: Availability | "unsupported" = "available",
) {
  return {
    info: { backend, model: backend, device: "test" },
    availability: vi.fn(async () => availability),
    enable: vi.fn(async () => {}),
    generate: vi.fn(async function* () {
      yield "actual model output";
    }),
    destroy: vi.fn(),
  } satisfies LocalModel;
}

describe("browser inference selection", () => {
  it.each(["unsupported", "unavailable"] as const)(
    "loads Transformers.js when native API is %s",
    async (availability) => {
      const chrome = model("chrome", availability);
      const fallback = model("transformers", "downloadable");
      const browser = new BrowserModel(chrome, fallback);
      expect(await browser.availability()).toBe("downloadable");
      await browser.enable(
        "Express system",
        new AbortController().signal,
        () => {},
      );
      expect(chrome.enable).not.toHaveBeenCalled();
      expect(fallback.enable).toHaveBeenCalled();
      expect(browser.info.backend).toBe("transformers");
      expect(browser.info.fallbackReason).toBeTruthy();
      const output: string[] = [];
      for await (const text of browser.generate(
        "request",
        "Express system",
        new AbortController().signal,
      ))
        output.push(text);
      expect(output).toEqual(["actual model output"]);
    },
  );

  it("retains the native API without loading fallback weights", async () => {
    const chrome = model("chrome");
    const fallback = model("transformers");
    const browser = new BrowserModel(chrome, fallback);
    await browser.availability();
    await browser.enable("system", new AbortController().signal, () => {});
    expect(chrome.enable).toHaveBeenCalled();
    expect(fallback.availability).not.toHaveBeenCalled();
    expect(fallback.enable).not.toHaveBeenCalled();
  });

  it("falls back after native creation failure, but never after cancellation", async () => {
    const chrome = model("chrome");
    const fallback = model("transformers");
    const browser = new BrowserModel(chrome, fallback);
    chrome.enable.mockRejectedValueOnce(new Error("native startup failed"));
    await browser.enable("system", new AbortController().signal, () => {});
    expect(fallback.enable).toHaveBeenCalledOnce();
    browser.destroy();
    expect(fallback.destroy).toHaveBeenCalledOnce();
    await browser.availability();
    const controller = new AbortController();
    chrome.enable.mockImplementationOnce(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    });
    await expect(
      browser.enable("system", controller.signal, () => {}),
    ).rejects.toThrow();
    expect(fallback.enable).toHaveBeenCalledOnce();
  });
});
