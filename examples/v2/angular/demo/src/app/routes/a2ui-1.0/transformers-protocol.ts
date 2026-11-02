import type { ModelInfo } from "./browser-model";
import type { ModelMessage } from "./model-messages";
import type { HubModelSource } from "./model-files";

/** Gemma 4 E4B instruction-tuned, the demo's default model. The
 * text-generation pipeline loads only its text sessions (embed_tokens,
 * decoder_model_merged; 4.9 GB in q4f16), not the vision or audio encoders of
 * the multimodal checkpoint. */
export const GPU_MODEL = "onnx-community/gemma-4-E4B-it-ONNX";
/** Gemma 3 1B instruction-tuned, text only, for browsers without WebGPU
 * half precision. Much smaller; its output quality for this task is not
 * established. */
export const CPU_MODEL = "onnx-community/gemma-3-1b-it-ONNX";

export type ModelRequest =
  | {
      type: "load";
      id: number;
      exportId?: string;
      modelRoot?: string;
      hubModel?: HubModelSource;
    }
  | { type: "generate"; id: number; messages: ModelMessage[] };

export type ModelResponse =
  | { type: "progress"; id: number; value: number; info: ModelInfo }
  | { type: "ready"; id: number; info: ModelInfo }
  | { type: "chunk"; id: number; text: string }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };

export const MODEL_REVISIONS: Record<string, string> = {
  [GPU_MODEL]: "2b6d2e26a962f70a33da8f7cd81e1afdd8d9cfb2",
  [CPU_MODEL]: "a58439f40017d3b99c7d378ff525e54e0ba08ebf",
};
