import {
  A2uiMessage,
  A2uiMessageSchema,
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import {
  AgentToRendererMessageSchema,
  type AgentToRendererMessage,
} from "@a2ui/web_core/v1_0";

type SurfaceMessage = A2uiMessage | AgentToRendererMessage;

function surfaceIdOf(message: SurfaceMessage): string | undefined {
  if ("createSurface" in message) return message.createSurface.surfaceId;
  if ("updateComponents" in message) return message.updateComponents.surfaceId;
  if ("updateDataModel" in message) return message.updateDataModel.surfaceId;
  if ("deleteSurface" in message) return message.deleteSurface.surfaceId;
  return undefined;
}

/**
 * Validates operations against their declared 0.9 or 1.0 protocol; unversioned
 * operations use the configured catalog's version. A 1.0 operation may say
 * "v1.0" or "1.0" and leaves as "1.0", the only spelling web_core accepts.
 * Every `createSurface` is pinned to `catalogId`:
 * the renderer runs one catalog and web_core rejects surfaces naming an unknown
 * one, so a stray id from the model would otherwise blank the surface. Anything
 * else, such as a v0.8 message, is dropped with a warning.
 */
export function normalizeA2UIOperations(
  operations: readonly unknown[],
  catalogId: string,
  protocolVersion: string = "0.9",
): SurfaceMessage[] {
  return operations.flatMap((operation) => {
    const message: Record<string, unknown> = {
      version: `v${protocolVersion.replace(/^v/, "")}`,
      ...(typeof operation === "object" ? operation : {}),
    };
    if (message["version"] === "v1.0") message["version"] = "1.0";
    if (
      message["createSurface"] &&
      typeof message["createSurface"] === "object"
    ) {
      message["createSurface"] = { ...message["createSurface"], catalogId };
    }
    const schema =
      message["version"] === "1.0"
        ? AgentToRendererMessageSchema
        : A2uiMessageSchema;
    const parsed = schema.safeParse(message);
    if (parsed.success) return [parsed.data];
    console.warn(
      `[A2UI Angular] Dropped an operation that is not an A2UI ${message["version"]} message:`,
      operation,
      parsed.error.issues,
    );
    return [];
  });
}

/**
 * Applies operations in order and returns the surfaces they address that
 * still exist. A `createSurface` for an existing surface is skipped, and a
 * surface addressed before it is created gets one with `catalogId` and `theme`.
 */
export function applyA2UIOperations<T extends ComponentApi>(
  processor: MessageProcessor<T>,
  operations: readonly unknown[],
  catalogId: string,
  theme?: Record<string, unknown>,
  protocolVersion: string = "0.9",
): SurfaceModel<T>[] {
  const surfaceIds = new Set<string>();
  const exists = (surfaceId: string) =>
    processor.model.getSurface(surfaceId) !== undefined;

  for (const message of normalizeA2UIOperations(
    operations,
    catalogId,
    protocolVersion,
  )) {
    const surfaceId = surfaceIdOf(message);
    if (surfaceId === undefined) {
      processor.processMessages([message]);
      continue;
    }
    surfaceIds.add(surfaceId);
    if ("createSurface" in message) {
      if (!exists(surfaceId)) processor.processMessages([message]);
      continue;
    }
    if ("deleteSurface" in message) {
      if (exists(surfaceId)) processor.processMessages([message]);
      continue;
    }
    if (!exists(surfaceId)) {
      processor.processMessages(
        message.version === "1.0"
          ? { version: "1.0", createSurface: { surfaceId, catalogId } }
          : {
              version: message.version,
              createSurface: { surfaceId, catalogId, theme: theme ?? {} },
            },
      );
    }
    processor.processMessages([message]);
  }

  return [...surfaceIds]
    .map((surfaceId) => processor.model.getSurface(surfaceId))
    .filter((surface): surface is SurfaceModel<T> => surface !== undefined);
}
