import { createContext, useContext, useRef, useState, useMemo } from "react";
import type { ReactNode } from "react";
import { MessageProcessor, RELAXED_VALIDATION } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "../a2ui-react";
import { basicCatalogV1 } from "../a2ui-react/catalog/basic/v1";
import type { A2UIContextValue, A2UIActions } from "./store";
import { ThemeProvider } from "../theme/ThemeContext";
import type { OnActionCallback } from "../types";
import type { A2UIClientEventMessage, Theme } from "../../a2ui-types";

/**
 * Agents send A2UI 1.0 as "v1.0" or "1.0"; web_core accepts only "1.0".
 */
function withWireVersion(
  message: Record<string, unknown>,
): Record<string, unknown> {
  return message.version === "v1.0" ? { ...message, version: "1.0" } : message;
}

/**
 * Context for stable actions (never changes reference, prevents re-renders).
 */
const A2UIActionsContext = createContext<A2UIActions | null>(null);

/**
 * Context for reactive state (changes trigger re-renders).
 */
const A2UIStateContext = createContext<{
  version: number;
  error: string | null;
} | null>(null);

/**
 * Props for the A2UIProvider component.
 */
export interface A2UIProviderProps {
  /** Callback invoked when a user action is dispatched (button click, etc.) */
  onAction?: OnActionCallback;
  /** Theme configuration */
  theme?: Theme;
  /** Optional component catalog to use instead of the default basicCatalog */
  catalog?: any;
  /** Child components */
  children: ReactNode;
}

/**
 * Provider for A2UI 0.9 and 1.0 surfaces. A custom catalog selects its protocol.
 * Uses a two-context architecture for performance:
 * - A2UIActionsContext: Stable actions that never change (no re-renders)
 * - A2UIStateContext: Reactive state that triggers re-renders when needed
 */
export function A2UIProvider({
  onAction,
  theme,
  catalog,
  children,
}: A2UIProviderProps) {
  // Store onAction in a ref so callbacks always have the latest value
  const onActionRef = useRef<OnActionCallback | null>(onAction ?? null);
  onActionRef.current = onAction ?? null;

  // The shared processor chooses an adapter from each message's wire version.
  const processorRef = useRef<MessageProcessor<any> | null>(null);
  if (!processorRef.current) {
    processorRef.current = new MessageProcessor(
      catalog ? [catalog] : [basicCatalog, basicCatalogV1],
      undefined,
      {
        version:
          catalog?.protocolVersion?.replace(/^v/, "") === "1.0"
            ? "1.0"
            : "v0.9",
        validationConfig: {
          ...RELAXED_VALIDATION,
          allowUnknownElements: false,
        },
      },
    );
    // Preserve CopilotKit's action callback shape for both wire versions.
    // Each surface's listener is awaited by `surface.dispatchAction`; the
    // processor-wide handler is not, since web_core 0.15.
    processorRef.current.model.onSurfaceCreated.subscribe((surface) => {
      surface.onAction.subscribe((action: any) => {
        if (onActionRef.current) {
          const message: A2UIClientEventMessage = {
            userAction: {
              ...action,
              name: action?.name ?? "unknown",
              surfaceId: action?.surfaceId ?? "default",
              sourceComponentId: action?.sourceComponentId,
              context: action?.context,
              timestamp: action?.timestamp ?? new Date().toISOString(),
            },
          };
          return onActionRef.current(message);
        }
      });
    });
  }
  const processor = processorRef.current;

  // Version counter for triggering re-renders
  const [version, setVersion] = useState(0);

  // Error state for graceful error handling
  const [error, setError] = useState<string | null>(null);
  const failedOperationKinds = useRef<Set<string>>(new Set());

  // Create stable actions object once - stored in ref, never changes
  const actionsRef = useRef<A2UIActions | null>(null);
  if (!actionsRef.current) {
    actionsRef.current = {
      processMessages: (messages: Array<Record<string, unknown>>) => {
        const kinds = [
          "createSurface",
          "updateComponents",
          "updateDataModel",
          "deleteSurface",
        ].filter((kind) => messages.some((message) => kind in message));
        try {
          processor.processMessages(messages.map(withWireVersion) as any[]);
        } catch (err) {
          console.warn("[A2UI] processMessages error:", err);
          failedOperationKinds.current = new Set(kinds);
          const names = messages.flatMap((message) => {
            const update = message.updateComponents as
              | { components?: { component?: string }[] }
              | undefined;
            return (
              update?.components?.flatMap((component) =>
                component.component ? [component.component] : [],
              ) ?? []
            );
          });
          const detail = err instanceof Error ? err.message : String(err);
          setError(
            names.length
              ? `${[...new Set(names)].join(", ")}: ${detail}`
              : detail,
          );
          return;
        }
        // A subsequent data frame cannot repair a rejected component tree.
        // Retain its diagnostic until that operation is corrected or the
        // surface lifecycle starts again. Newer web_core rejects it before
        // a component error boundary can mount.
        if (
          kinds.some(
            (kind) =>
              failedOperationKinds.current.has(kind) ||
              kind === "createSurface" ||
              kind === "deleteSurface",
          )
        ) {
          failedOperationKinds.current.clear();
          setError(null);
        }
        setVersion((v) => v + 1);
      },

      dispatch: (message: any) => onActionRef.current?.(message),

      getSurface: (surfaceId: string) => {
        return processor.model.getSurface(surfaceId);
      },

      clearSurfaces: () => {
        // Process a deleteSurface for all known surfaces
        const surfaces = processor.model.surfacesMap;
        for (const [id, surface] of surfaces) {
          processor.processMessages([
            withWireVersion({
              version: `v${String(surface.protocolVersion ?? "0.9").replace(/^v/, "")}`,
              deleteSurface: { surfaceId: id },
            }) as any,
          ]);
        }
        setVersion((v) => v + 1);
      },
    };
  }
  const actions = actionsRef.current;

  // State context value - changes when version or error changes
  const stateValue = useMemo(() => ({ version, error }), [version, error]);

  return (
    <A2UIActionsContext.Provider value={actions}>
      <A2UIStateContext.Provider value={stateValue}>
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </A2UIStateContext.Provider>
    </A2UIActionsContext.Provider>
  );
}

/**
 * Hook to access stable A2UI actions (won't cause re-renders).
 */
export function useA2UIActions(): A2UIActions {
  const actions = useContext(A2UIActionsContext);
  if (!actions) {
    throw new Error("useA2UIActions must be used within an A2UIProvider");
  }
  return actions;
}

/**
 * Hook to subscribe to A2UI state changes.
 */
export function useA2UIState(): { version: number } {
  const state = useContext(A2UIStateContext);
  if (!state) {
    throw new Error("useA2UIState must be used within an A2UIProvider");
  }
  return state;
}

/**
 * Hook to access the full A2UI context (actions + state).
 */
export function useA2UIContext(): A2UIContextValue {
  const actions = useA2UIActions();
  const state = useA2UIState();

  return useMemo(
    () => ({
      ...actions,
      version: state.version,
      onAction: null,
    }),
    [actions, state.version],
  );
}

/** @deprecated Use useA2UIContext instead. */
export const useA2UIStore = useA2UIContext;

/**
 * Hook to access the current A2UI error state.
 */
export function useA2UIError(): string | null {
  const state = useContext(A2UIStateContext);
  return state?.error ?? null;
}

/** @deprecated Use useA2UIContext() or useA2UI() directly instead. */
export function useA2UIStoreSelector<T>(
  selector: (state: A2UIContextValue) => T,
): T {
  const context = useA2UIContext();
  return selector(context);
}
