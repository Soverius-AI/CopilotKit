import { AngularToolCall } from "../../tools";
import {
  A2UIOperation,
  getA2UIOperations,
  isRecord,
} from "./a2ui-surface-host";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  RenderA2UIArgs,
} from "./a2ui-tool-types";
import { A2UI_BASIC_CATALOG_ID } from "./a2ui-catalog-context";

type A2UISnapshot = {
  version?: "v0.9" | "v1.0";
  surfaceId: string;
  catalogId?: string;
  data?: unknown;
  components: unknown[];
};

function parseJsonResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function getSnapshot(payload: unknown): A2UISnapshot | undefined {
  if (!isRecord(payload)) return undefined;
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : payload;
  if (
    typeof snapshot.surfaceId !== "string" ||
    !Array.isArray(snapshot.components)
  ) {
    return undefined;
  }

  return {
    version:
      snapshot.version === "v1.0" || snapshot.version === "1.0"
        ? "v1.0"
        : snapshot.version === "v0.9"
          ? "v0.9"
          : undefined,
    surfaceId: snapshot.surfaceId,
    catalogId:
      typeof snapshot.catalogId === "string" ? snapshot.catalogId : undefined,
    data: snapshot.data,
    components: snapshot.components,
  };
}

function operationsFromSnapshot(
  snapshot: A2UISnapshot,
  protocolVersion: string,
): A2UIOperation[] {
  const version =
    snapshot.version ??
    (protocolVersion.replace(/^v/, "") === "1.0" ? "v1.0" : "v0.9");
  const operations: A2UIOperation[] = [
    {
      version,
      createSurface: {
        surfaceId: snapshot.surfaceId,
        catalogId:
          snapshot.catalogId ??
          (version === "v1.0"
            ? "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            : A2UI_BASIC_CATALOG_ID),
        ...(version === "v0.9" ? { theme: {} } : {}),
      },
    },
  ];

  if (snapshot.data !== undefined) {
    operations.push({
      version,
      updateDataModel: {
        surfaceId: snapshot.surfaceId,
        path: "/",
        value: snapshot.data,
      },
    });
  }

  operations.push({
    version,
    updateComponents: {
      surfaceId: snapshot.surfaceId,
      components: snapshot.components,
    },
  });

  return operations;
}

function getOperationsFromPayload(
  payload: unknown,
  protocolVersion: string,
): A2UIOperation[] {
  if (!isRecord(payload)) return [];

  const operations = getA2UIOperations(payload);
  if (operations.length > 0) return operations;

  const snapshot = getSnapshot(payload);
  return snapshot ? operationsFromSnapshot(snapshot, protocolVersion) : [];
}

function getOperationsFromResult(
  result: string | undefined,
  protocolVersion: string,
): A2UIOperation[] {
  if (!result) return [];
  const payload = parseJsonResult(result);
  return getOperationsFromPayload(payload, protocolVersion);
}

export function getRenderedA2UIOperations(
  toolCall: AngularToolCall<RenderA2UIArgs>,
  protocolVersion = "0.9",
): A2UIOperation[] {
  const resultOperations = getOperationsFromResult(
    toolCall.result,
    protocolVersion,
  );
  if (resultOperations.length > 0) {
    return resultOperations;
  }

  if (
    toolCall.name === AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME &&
    toolCall.status !== "complete"
  ) {
    return [];
  }

  return getOperationsFromPayload(toolCall.args, protocolVersion);
}
