import { ChromeModel } from "./chrome-model";
import { E2B_EXPORT_ID } from "./model-identity";
import { TransformersModel } from "./transformers-model";

export const BROWSER_MODEL_MODES = [
  "finetuned",
  "finetuned-e2b",
  "base",
  "chrome",
] as const;
export type BrowserModelMode = (typeof BROWSER_MODEL_MODES)[number];

export interface ModelInfo {
  backend: "chrome" | "transformers";
  model: string;
  device: string;
  fallbackReason?: string;
  artifactSha256?: string;
}

export interface LocalModel {
  readonly info: ModelInfo;
  availability(): Promise<Availability | "unsupported">;
  enable(
    system: string,
    signal: AbortSignal,
    progress: (value: number) => void,
  ): Promise<void>;
  generate(
    input: string,
    system: string,
    signal: AbortSignal,
  ): AsyncIterable<string>;
  destroy(): void;
}

/**
 * Chrome could not start its model, and the fallback is now selected but not
 * loaded: its weights are a large download that needs the user's choice.
 */
export class FallbackSelectedError extends Error {
  override name = "FallbackSelectedError";
}

/** Run Gemma 4 E4B in-browser. The E4B and E2B fine-tunes and Chrome's
 * built-in model are opt-in comparisons. */
export class BrowserModel implements LocalModel {
  #selected: LocalModel;
  #fallbackReason?: string;
  /** Once native startup fails, keep the fallback for this page session. */
  #nativeFailed = false;
  #mode: BrowserModelMode | undefined;

  constructor(
    private readonly chrome: LocalModel = new ChromeModel(),
    private readonly transformers: LocalModel = new TransformersModel(),
    private readonly explicitExport = true,
    private readonly base: LocalModel = new TransformersModel(undefined, null),
    private readonly e2b: LocalModel = new TransformersModel(
      undefined,
      E2B_EXPORT_ID,
    ),
  ) {
    this.#mode = explicitExport ? "base" : undefined;
    this.#selected = explicitExport ? base : chrome;
  }

  selectMode(mode: BrowserModelMode) {
    this.destroy();
    this.#mode = mode;
    this.#nativeFailed = false;
    this.#fallbackReason = undefined;
    this.#selected =
      mode === "chrome"
        ? this.chrome
        : mode === "base"
          ? this.base
          : mode === "finetuned-e2b"
            ? this.e2b
            : this.transformers;
  }

  get info(): ModelInfo {
    return { ...this.#selected.info, fallbackReason: this.#fallbackReason };
  }

  async availability() {
    if (this.#mode) return this.#selected.availability();
    if (this.#nativeFailed) return this.transformers.availability();
    const native = await this.chrome
      .availability()
      .catch(() => "unavailable" as const);
    if (native !== "unsupported" && native !== "unavailable") {
      this.#selected = this.chrome;
      this.#fallbackReason = undefined;
      return native;
    }
    this.#selected = this.transformers;
    this.#fallbackReason =
      native === "unsupported"
        ? "Chrome Prompt API is absent."
        : "Chrome Prompt API cannot provide a model.";
    return this.transformers.availability();
  }

  async enable(
    system: string,
    signal: AbortSignal,
    progress: (value: number) => void,
  ) {
    try {
      await this.#selected.enable(system, signal, progress);
    } catch (error) {
      signal.throwIfAborted();
      if (this.#mode || this.#selected !== this.chrome) throw error;
      this.chrome.destroy();
      this.#nativeFailed = true;
      this.#selected = this.transformers;
      this.#fallbackReason = "Chrome could not start its local model.";
      progress(0);
      throw new FallbackSelectedError(
        `Chrome could not start its local model (${error instanceof Error ? error.message : String(error)}). No fallback weights were downloaded. Select Download & enable to load ${this.transformers.info.model} with Transformers.js instead.`,
      );
    }
  }

  generate(input: string, system: string, signal: AbortSignal) {
    return this.#selected.generate(input, system, signal);
  }

  destroy() {
    this.chrome.destroy();
    this.transformers.destroy();
    this.base.destroy();
    this.e2b.destroy();
  }
}
