/** Model identity is shared with the worker without importing app deployment URLs.
 * The target is the step-40 adapter of the second Gemma 4 E4B run. */
export const TARGET_EXPORT_ID = "e4b-pilot2s40-d53063f5f606";
export const TARGET_ADAPTER_SHA256 =
  "d53063f5f606317cd9db5dd4bfc904e034d7f73a06b068155607459acc819fe2";
/** The smaller comparison: the step-100 adapter of the E2B run on the same rows. */
export const E2B_EXPORT_ID = "e2b-mlx1s100-eff96be9f058";
export const E2B_ADAPTER_SHA256 =
  "eff96be9f058aec7993a0b1618d1d20c60eb4519d54f54c2352865ad297490f2";
/** The adapter each published export must serve; the worker loads no substitute. */
export const PUBLISHED_ADAPTERS: Readonly<Record<string, string>> = {
  [TARGET_EXPORT_ID]: TARGET_ADAPTER_SHA256,
  [E2B_EXPORT_ID]: E2B_ADAPTER_SHA256,
};

/** A Studio E2B round, or an `mlx_lm` adapter named
 * `<e2b|e4b>-<run>-<adapter hash prefix>`. */
export function isLocalExportId(id: string): boolean {
  return /^(round2-probe|round[1-9]\d*-[a-f0-9]{12}|e[24]b-[a-z0-9]+-[a-f0-9]{12})$/.test(
    id,
  );
}

/** The Gemma 4 checkpoint an export was merged into: its size, Hugging Face
 * base, the ONNX matrices its adapter patches and its q4f16 download. Studio
 * adapted 170 E2B matrices; `mlx_lm` adapts every projection, including the
 * per-layer input gates, which is 240 on E2B and 300 on E4B. */
export function exportBase(id: string) {
  return id.startsWith("e4b-")
    ? {
        size: "E4B",
        model: "unsloth/gemma-4-E4B-it",
        matrices: 300,
        gigabytes: 4.9,
      }
    : {
        size: "E2B",
        model: "unsloth/gemma-4-E2B-it",
        matrices: id.startsWith("e2b-") ? 240 : 170,
        gigabytes: 3.1,
      };
}

/** `mlx_lm` ids carry their size; the Studio E2B rounds predate it. */
export const localModelId = (id: string) =>
  `local/gemma-4-${/^e[24]b-/.test(id) ? id : `e2b-${id}`}`;
