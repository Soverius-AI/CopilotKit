import { ChromeModel } from "./chrome-model";
import { TransformersModel } from "./transformers-model";

export interface ModelInfo {
  backend: "chrome" | "transformers";
  model: string;
  device: string;
  fallbackReason?: string;
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

/** Prefer the native API; otherwise execute downloaded weights in this browser. */
export class BrowserModel implements LocalModel {
  #selected: LocalModel;
  #fallbackReason?: string;

  constructor(
    private readonly chrome: LocalModel = new ChromeModel(),
    private readonly transformers: LocalModel = new TransformersModel(),
  ) {
    this.#selected = chrome;
  }

  get info(): ModelInfo {
    return { ...this.#selected.info, fallbackReason: this.#fallbackReason };
  }

  async availability() {
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
      if (this.#selected !== this.chrome) throw error;
      this.chrome.destroy();
      this.#selected = this.transformers;
      this.#fallbackReason = "Chrome could not start its local model.";
      progress(0);
      await this.transformers.enable(system, signal, progress);
    }
  }

  generate(input: string, system: string, signal: AbortSignal) {
    return this.#selected.generate(input, system, signal);
  }

  destroy() {
    this.chrome.destroy();
    this.transformers.destroy();
  }
}
