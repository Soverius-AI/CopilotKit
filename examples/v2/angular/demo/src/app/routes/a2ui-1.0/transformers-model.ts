import type { LocalModel, ModelInfo } from "./browser-model";
import { modelMessages } from "./model-messages";
import { GPU_MODEL } from "./transformers-protocol";
import type { ModelRequest, ModelResponse } from "./transformers-protocol";

/** The heavy runtime and weights only enter a worker after Enable is clicked. */
export class TransformersModel implements LocalModel {
  info: ModelInfo = {
    backend: "transformers",
    model: GPU_MODEL,
    device: "WebGPU / WASM",
  };
  #worker?: Worker;
  #system?: string;
  #nextId = 0;
  #pending?: (message: ModelResponse) => void;

  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./transformers.worker", import.meta.url), {
        type: "module",
      }),
  ) {}

  async availability(): Promise<Availability | "unsupported"> {
    return typeof Worker === "undefined" || typeof WebAssembly === "undefined"
      ? "unsupported"
      : "downloadable";
  }

  async enable(
    system: string,
    signal: AbortSignal,
    progress: (value: number) => void,
  ) {
    this.destroy();
    signal.throwIfAborted();
    const worker = this.createWorker();
    this.#worker = worker;
    const id = ++this.#nextId;
    worker.onmessage = ({ data }: MessageEvent<ModelResponse>) =>
      this.#pending?.(data);
    worker.onerror = (event) => {
      if (this.#worker === worker)
        this.#pending?.({
          type: "error",
          id: this.#nextId,
          message: event.message || "Browser model worker failed.",
        });
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener("abort", abort);
          this.#pending = undefined;
        };
        const abort = () => {
          cleanup();
          this.destroy();
          reject(signal.reason);
        };
        this.#pending = (message) => {
          if (message.id !== id) return;
          if (message.type === "progress" || message.type === "ready") {
            this.info = message.info;
            progress(message.type === "ready" ? 1 : message.value);
          }
          if (message.type === "ready") {
            cleanup();
            resolve();
          }
          if (message.type === "error") {
            cleanup();
            reject(new Error(message.message));
          }
        };
        signal.addEventListener("abort", abort, { once: true });
        worker.postMessage({ type: "load", id } satisfies ModelRequest);
      });
      signal.throwIfAborted();
      this.#system = system;
    } catch (error) {
      if (this.#worker === worker) this.destroy();
      throw error;
    }
  }

  async *generate(input: string, system: string, signal: AbortSignal) {
    if (!this.#worker || this.#system !== system)
      throw new Error("Enable the browser model before generating.");
    signal.throwIfAborted();
    const id = ++this.#nextId;
    const queue: string[] = [];
    let done = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;
    const abort = () => {
      this.destroy();
      wake?.();
    };
    this.#pending = (message) => {
      if (message.id !== id) return;
      if (message.type === "chunk") queue.push(message.text);
      if (message.type === "done") done = true;
      if (message.type === "error") {
        done = true;
        failure = new Error(message.message);
      }
      wake?.();
    };
    signal.addEventListener("abort", abort, { once: true });
    this.#worker.postMessage({
      type: "generate",
      id,
      messages: [{ role: "system", content: system }, ...modelMessages(input)],
    } satisfies ModelRequest);
    try {
      while (true) {
        signal.throwIfAborted();
        if (failure) throw failure;
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (done) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", abort);
      this.#pending = undefined;
    }
  }

  destroy() {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#system = undefined;
  }
}
