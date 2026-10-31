import type { ModelInfo } from "./browser-model";
import type { ModelMessage } from "./model-messages";

export const GPU_MODEL = "onnx-community/Qwen3.5-4B-ONNX-OPT";
export const CPU_MODEL = "onnx-community/Qwen3.5-0.8B-ONNX-OPT";

export type ModelRequest =
  | { type: "load"; id: number }
  | { type: "generate"; id: number; messages: ModelMessage[] };

export type ModelResponse =
  | { type: "progress"; id: number; value: number; info: ModelInfo }
  | { type: "ready"; id: number; info: ModelInfo }
  | { type: "chunk"; id: number; text: string }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };

export const MODEL_REVISIONS: Record<string, string> = {
  [GPU_MODEL]: "bb072268d0912bdc5cf4f41c8c6f53a03fd68624",
  [CPU_MODEL]: "9a4c21d8f724176b0a7edaaed36303044451886e",
};
