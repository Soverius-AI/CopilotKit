/// <reference lib="webworker" />
import {
  env,
  Gemma4Processor,
  pipeline,
  TextStreamer,
} from "@huggingface/transformers";
import type { TextGenerationPipeline } from "@huggingface/transformers";
import type { ModelInfo } from "./browser-model";
import { GPU_MODEL, MODEL_REVISIONS } from "./transformers-protocol";
import type { ModelRequest, ModelResponse } from "./transformers-protocol";
import {
  exportBase,
  isLocalExportId,
  localModelId,
  PUBLISHED_ADAPTERS,
} from "./model-identity";
import { modelFilesRoot, hubModelFilesRoot } from "./model-files";

env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;

let generator: TextGenerationPipeline | undefined;
/** Set when the tokenizer has no chat template of its own. */
let chatTemplate: string | undefined;
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
        // Both Gemma comparisons use the same q4f16 base and GPU requirements.
        const f16 = adapter?.features.has("shader-f16") ?? false;
        if (!f16)
          throw new Error(
            "Gemma 4 requires WebGPU with half precision. No substitute model was loaded; Chrome Prompt API can be selected separately.",
          );
        if (data.exportId && !isLocalExportId(data.exportId))
          throw new Error("Unknown local Gemma export.");
        // A published export must serve its own adapter; experiments may serve any.
        const publishedAdapter = data.exportId
          ? PUBLISHED_ADAPTERS[data.exportId]
          : undefined;
        if (data.hubModel && (!publishedAdapter || data.modelRoot))
          throw new Error(
            "Hugging Face hosting is only configured for the published fine-tunes.",
          );
        const hubRoot = data.hubModel
          ? hubModelFilesRoot(data.hubModel)
          : undefined;
        const model =
          data.hubModel?.repoId ??
          (data.exportId ? localModelId(data.exportId) : GPU_MODEL);
        const device = "webgpu";
        const revision = data.hubModel?.revision ?? MODEL_REVISIONS[model];
        const info: ModelInfo = { backend: "transformers", model, device };
        if (data.exportId) {
          const modelRoot =
            hubRoot ?? modelFilesRoot(data.modelRoot, self.location.origin);
          const response = await fetch(
            `${modelRoot}${hubRoot ? "" : model + "/"}a2ui-export-manifest.json`,
          );
          if (!response.ok)
            throw new Error(
              "The selected fine-tuned model files are unavailable.",
            );
          const artifact = await response.json();
          if (publishedAdapter && artifact.adapter_sha256 !== publishedAdapter)
            throw new Error(
              "The model server did not return the selected Express fine-tune. No substitute model was loaded.",
            );
          const base = exportBase(data.exportId);
          if (
            artifact.base_model !== base.model ||
            artifact.dtype !== "q4f16" ||
            artifact.patched_onnx_matrices !== base.matrices ||
            !artifact.decoder_graph_unchanged
          )
            throw new Error(
              "The local export manifest does not match the verified Gemma browser format.",
            );
          info.artifactSha256 = artifact.adapter_sha256;
          // Metadata and weights use the same explicit source. Hub requests
          // resolve at the pinned revision passed to both pipeline and processor.
          env.allowLocalModels = false;
          env.allowRemoteModels = true;
          env.remoteHost = hubRoot ? "https://huggingface.co/" : modelRoot;
          env.remotePathTemplate = hubRoot
            ? "{model}/resolve/{revision}/"
            : "{model}/";
        }
        send({ type: "progress", id, value: 0, info });
        // For a multimodal checkpoint such as Gemma 4, the text-generation
        // pipeline downloads and runs only the text sessions.
        generator = await pipeline("text-generation", model, {
          device,
          dtype: "q4f16",
          revision,
          progress_callback: (event) => {
            if (event.status === "progress_total")
              send({ type: "progress", id, value: event.progress / 100, info });
          },
        });
        // Gemma 4 can keep its template in chat_template.jinja, which only
        // its processor reads; that adds small JSON files, no weights.
        chatTemplate =
          !generator.tokenizer.chat_template &&
          (model === GPU_MODEL || !!data.exportId)
            ? ((await Gemma4Processor.from_pretrained(model, { revision }))
                .chat_template ?? undefined)
            : undefined;
        send({ type: "ready", id, info });
      } else {
        if (!generator) throw new Error("The browser model is not loaded.");
        const streamer = new TextStreamer(generator.tokenizer, {
          skip_prompt: true,
          callback_function: (text) => send({ type: "chunk", id, text }),
        });
        // Keep sampled variation out of strict DSL generation. GPU execution
        // can still differ between otherwise identical runs.
        await generator(data.messages, {
          max_new_tokens: 3072,
          do_sample: false,
          ...(chatTemplate ? { chat_template: chatTemplate } : {}),
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
