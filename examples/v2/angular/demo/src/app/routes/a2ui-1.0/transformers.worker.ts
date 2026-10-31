/// <reference lib="webworker" />
import { env, pipeline, TextStreamer } from "@huggingface/transformers";
import type { TextGenerationPipeline } from "@huggingface/transformers";
import type { ModelInfo } from "./browser-model";
import { CPU_MODEL, GPU_MODEL, MODEL_REVISIONS } from "./transformers-protocol";
import type { ModelRequest, ModelResponse } from "./transformers-protocol";

env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;

let generator: TextGenerationPipeline | undefined;
const send = (message: ModelResponse) => self.postMessage(message);

self.addEventListener(
  "message",
  async ({ data }: MessageEvent<ModelRequest>) => {
    const { id } = data;
    try {
      if (data.type === "load") {
        const gpu = (
          navigator as WorkerNavigator & {
            gpu?: {
              requestAdapter(): Promise<{
                features: { has(name: string): boolean };
              } | null>;
            };
          }
        ).gpu;
        const adapter = await gpu?.requestAdapter().catch(() => null);
        const device = adapter ? "webgpu" : "wasm";
        const model = adapter ? GPU_MODEL : CPU_MODEL;
        const dtype = adapter?.features.has("shader-f16") ? "q4f16" : "q4";
        const info: ModelInfo = { backend: "transformers", model, device };
        send({ type: "progress", id, value: 0, info });
        generator = await pipeline("text-generation", model, {
          device,
          dtype,
          revision: MODEL_REVISIONS[model],
          progress_callback: (event) => {
            if (event.status === "progress_total")
              send({ type: "progress", id, value: event.progress / 100, info });
          },
        });
        send({ type: "ready", id, info });
      } else {
        if (!generator) throw new Error("The browser model is not loaded.");
        const streamer = new TextStreamer(generator.tokenizer, {
          skip_prompt: true,
          callback_function: (text) => send({ type: "chunk", id, text }),
        });
        await generator(data.messages, {
          max_new_tokens: 3072,
          do_sample: true,
          temperature: 0.7,
          top_p: 0.8,
          top_k: 20,
          repetition_penalty: 1.05,
          tokenizer_encode_kwargs: { enable_thinking: false },
          return_full_text: false,
          streamer,
        });
        send({ type: "done", id });
      }
    } catch (error) {
      send({
        type: "error",
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
