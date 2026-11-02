import { describe, expect, it, vi } from "vitest";
import { BrowserModel, FallbackSelectedError } from "./browser-model";
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
  it("switches between the tuned, original and explicitly selected native models", async () => {
    const chrome = model("chrome", "unavailable");
    const tuned = model("transformers", "downloadable");
    const base = model("transformers", "downloadable");
    const e2b = model("transformers", "downloadable");
    const browser = new BrowserModel(chrome, tuned, true, base, e2b);
    browser.selectMode("finetuned-e2b");
    await browser.enable("SDK guide", new AbortController().signal, () => {});
    expect(e2b.enable).toHaveBeenCalledOnce();
    expect(tuned.enable).not.toHaveBeenCalled();
    browser.selectMode("base");
    expect(e2b.destroy).toHaveBeenCalled();
    await browser.availability();
    await browser.enable("SDK guide", new AbortController().signal, () => {});
    expect(base.enable).toHaveBeenCalledOnce();
    expect(tuned.enable).not.toHaveBeenCalled();
    browser.selectMode("chrome");
    expect(base.destroy).toHaveBeenCalled();
    expect(await browser.availability()).toBe("unavailable");
    expect(browser.info.backend).toBe("chrome");
    chrome.enable.mockRejectedValueOnce(new Error("native unavailable"));
    await expect(
      browser.enable("SDK guide", new AbortController().signal, () => {}),
    ).rejects.toThrow("native unavailable");
    expect(tuned.enable).not.toHaveBeenCalled();
    browser.selectMode("finetuned");
    await browser.enable("SDK guide", new AbortController().signal, () => {});
    expect(tuned.enable).toHaveBeenCalledOnce();
  });
  it("uses Gemma 4 E4B by default even when Chrome's different model is available", async () => {
    const chrome = model("chrome");
    const target = model("transformers", "downloadable");
    const tuned = model("transformers", "downloadable");
    const browser = new BrowserModel(chrome, tuned, true, target);
    await browser.availability();
    await browser.enable(
      "standard SDK guide",
      new AbortController().signal,
      () => {},
    );
    expect(target.enable).toHaveBeenCalledOnce();
    expect(chrome.availability).not.toHaveBeenCalled();
    expect(chrome.enable).not.toHaveBeenCalled();
    target.enable.mockRejectedValueOnce(
      new Error("selected weights unavailable"),
    );
    await expect(
      browser.enable(
        "standard SDK guide",
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("selected weights unavailable");
    expect(chrome.enable).not.toHaveBeenCalled();
  });
  it.each(["unsupported", "unavailable"] as const)(
    "loads Transformers.js when native API is %s",
    async (availability) => {
      const chrome = model("chrome", availability);
      const fallback = model("transformers", "downloadable");
      const browser = new BrowserModel(chrome, fallback, false);
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
    const browser = new BrowserModel(chrome, fallback, false);
    await browser.availability();
    await browser.enable("system", new AbortController().signal, () => {});
    expect(chrome.enable).toHaveBeenCalled();
    expect(fallback.availability).not.toHaveBeenCalled();
    expect(fallback.enable).not.toHaveBeenCalled();
  });

  it("selects the fallback after native startup failure without downloading it", async () => {
    const chrome = model("chrome");
    const fallback = model("transformers", "downloadable");
    const browser = new BrowserModel(chrome, fallback, false);
    await browser.availability();
    chrome.enable.mockRejectedValueOnce(new Error("native startup failed"));
    await expect(
      browser.enable("system", new AbortController().signal, () => {}),
    ).rejects.toThrow(FallbackSelectedError);
    expect(fallback.enable).not.toHaveBeenCalled();
    expect(browser.info).toMatchObject({
      backend: "transformers",
      fallbackReason: "Chrome could not start its local model.",
    });
    // The choice holds for the page session, even though Chrome still
    // reports a model, so Stop or Reset does not ask about Chrome again.
    expect(await browser.availability()).toBe("downloadable");
    await browser.enable("system", new AbortController().signal, () => {});
    expect(chrome.enable).toHaveBeenCalledOnce();
    expect(fallback.enable).toHaveBeenCalledOnce();
  });

  it("never selects the fallback after cancellation", async () => {
    const chrome = model("chrome");
    const fallback = model("transformers");
    const browser = new BrowserModel(chrome, fallback, false);
    await browser.availability();
    const controller = new AbortController();
    chrome.enable.mockImplementationOnce(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    });
    await expect(
      browser.enable("system", controller.signal, () => {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(browser.info.backend).toBe("chrome");
    expect(fallback.enable).not.toHaveBeenCalled();
  });
});
