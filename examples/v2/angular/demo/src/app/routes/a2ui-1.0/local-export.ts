import { EXPRESS_DEPLOYMENT } from "./deployment";
import { isLocalExportId } from "./model-identity";
export {
  E2B_EXPORT_ID,
  E2B_ADAPTER_SHA256,
  PUBLISHED_ADAPTERS,
  TARGET_EXPORT_ID,
  TARGET_ADAPTER_SHA256,
  exportBase,
  isLocalExportId,
  localModelId,
} from "./model-identity";

export function localExportId(): string | undefined {
  if (
    typeof location === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  )
    return undefined;
  const id = new URLSearchParams(location.search).get("gemmaExport");
  return id && isLocalExportId(id) ? id : undefined;
}

export const LOCAL_MODEL_ROOT = EXPRESS_DEPLOYMENT.modelRoot;
/** The published exports this deployment loads from Hugging Face, by export id. */
export const CONFIGURED_HUB_MODELS = EXPRESS_DEPLOYMENT.hubModels;

/** The published export a configured Hub repository serves. */
export const hubExportId = (repoId: string | undefined) =>
  Object.keys(CONFIGURED_HUB_MODELS).find(
    (id) => CONFIGURED_HUB_MODELS[id].repoId === repoId,
  );
