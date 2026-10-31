import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  envelopeToManifest,
  getOperationSurfaceId,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import type { A2UIOperation, GenerativeUIManifest } from "@copilotkit/shared";
import { Observable } from "rxjs";
import { ChromeModel } from "./chrome-model";
import { createExpressCompiler } from "./express-compiler";
import type { ExpressCompiler } from "./express-compiler";
import { demoActionSource } from "./demo-actions";

export const EXPRESS_AGENT_ID = "a2ui-1.0";
export const EXPRESS_TARGET = "express-preview";

export interface ExpressDebugState {
  availability: string;
  downloadProgress: number;
  modelStarting: boolean;
  stage:
    | "idle"
    | "preparing"
    | "generating"
    | "compiling"
    | "ready"
    | "error"
    | "cancelled";
  source: "model" | "manual";
  runId: string;
  surfaceId: string;
  systemPrompt: string;
  dsl: string;
  lastSuccessfulDsl: string;
  operations: A2UIOperation[];
  diagnostics: string[];
  elapsedMs: number;
  compileMs: number;
  action: unknown;
}

export const initialDebugState = (): ExpressDebugState => ({
  availability: "checking",
  downloadProgress: 0,
  modelStarting: false,
  stage: "idle",
  source: "manual",
  runId: "",
  surfaceId: "",
  systemPrompt: "",
  dsl: "",
  lastSuccessfulDsl: "",
  operations: [],
  diagnostics: [],
  elapsedMs: 0,
  compileMs: 0,
  action: null,
});

/** A real AG-UI agent: only inference is supplied by Chrome instead of a server. */
export class ChromeExpressAgent extends AbstractAgent {
  #compiler?: ExpressCompiler;
  #manifest?: GenerativeUIManifest;
  #controller?: AbortController;
  #enableController?: AbortController;
  #manualSource?: string;
  #manualSurfaces = new Set<string>();
  #modelReady = false;
  #configuration = 0;

  constructor(private readonly model = new ChromeModel()) {
    super({
      agentId: EXPRESS_AGENT_ID,
      initialState: { a2uiExpress: initialDebugState() },
    });
  }

  get debugState(): ExpressDebugState {
    return this.state.a2uiExpress ?? initialDebugState();
  }

  #update(patch: Partial<ExpressDebugState>) {
    this.setState({
      ...this.state,
      a2uiExpress: { ...this.debugState, ...patch },
    });
  }

  async configure(
    schema: Record<string, unknown>,
    manifest: GenerativeUIManifest,
  ) {
    const configuration = ++this.#configuration;
    this.#update({ stage: "preparing", diagnostics: [] });
    try {
      const compiler = await createExpressCompiler(schema);
      const availability = await this.model
        .availability()
        .catch(() => "unavailable");
      if (configuration !== this.#configuration) return;
      this.#compiler = compiler;
      this.#manifest = manifest;
      this.#update({
        stage: "idle",
        availability,
        systemPrompt: compiler.systemPrompt(manifest),
      });
    } catch (error) {
      if (configuration === this.#configuration)
        this.#update({ stage: "error", diagnostics: [errorMessage(error)] });
    }
  }

  async enable() {
    if (!this.#compiler) return;
    this.#enableController?.abort();
    const controller = new AbortController();
    this.#enableController = controller;
    this.#modelReady = false;
    this.#update({
      availability: "downloading",
      modelStarting: true,
      diagnostics: [],
    });
    try {
      await this.model.enable(
        this.debugState.systemPrompt,
        controller.signal,
        (downloadProgress) => {
          if (!controller.signal.aborted) this.#update({ downloadProgress });
        },
      );
      controller.signal.throwIfAborted();
      this.#modelReady = true;
      this.#update({
        availability: "enabled",
        modelStarting: false,
        downloadProgress: 1,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        this.#update({
          availability: "error",
          modelStarting: false,
          diagnostics: [errorMessage(error)],
        });
    }
  }

  /** The page still sends manual compilation through the same agent run. */
  useManualSource(source: string) {
    this.#manualSource = source;
  }
  cancel() {
    this.#controller?.abort();
  }

  dispose() {
    ++this.#configuration;
    this.#enableController?.abort();
    this.cancel();
    this.model.destroy();
    this.#modelReady = false;
    this.#compiler = undefined;
    this.#manualSource = undefined;
    this.#manualSurfaces.clear();
    this.#update({
      availability: "checking",
      modelStarting: false,
      stage: "idle",
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const controller = new AbortController();
      this.#controller = controller;
      const queuedSource = this.#manualSource;
      this.#manualSource = undefined;
      const emit = (event: Record<string, unknown>) => {
        if (!observer.closed) observer.next(event as BaseEvent);
      };
      const patch = (value: Partial<ExpressDebugState>) =>
        emit({
          type: EventType.STATE_DELTA,
          delta: Object.entries(value).map(([key, item]) => ({
            op: "replace",
            path: `/a2uiExpress/${key}`,
            value: item,
          })),
        });
      const started = performance.now();
      void (async () => {
        emit({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        });
        const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
        const manifest = envelope
          ? envelopeToManifest(envelope)
          : this.#manifest;
        const action = envelope?.metadata.extensions.copilotkit_action ?? null;
        const source =
          queuedSource ??
          (action && this.#manualSurfaces.has(action.action.surfaceId)
            ? demoActionSource(action)
            : undefined);
        const surfaceId = `express-${input.runId}`;
        emit({
          type: EventType.STATE_SNAPSHOT,
          snapshot: {
            ...input.state,
            a2uiExpress: {
              ...this.debugState,
              stage: "generating",
              source: source === undefined ? "model" : "manual",
              runId: input.runId,
              surfaceId,
              dsl: "",
              operations: [],
              diagnostics: [],
              elapsedMs: 0,
              compileMs: 0,
              action,
            },
          },
        });
        try {
          if (!this.#compiler || !manifest)
            throw new Error("The Express catalog is still loading.");
          let dsl = source ?? "";
          if (source === undefined) {
            if (!this.#modelReady)
              throw new Error(
                "Enable Chrome's local model first. You can also compile a preset without inference.",
              );
            let lastPublished = 0;
            // Surface data and application context are run data, never system instructions.
            // Bounded recent turns avoid duplicating an unbounded Chrome session history.
            const turns = input.messages
              .filter(
                (m) =>
                  (m.role === "user" || m.role === "assistant") &&
                  typeof m.content === "string",
              )
              .slice(-6)
              .map((m) => ({
                role: m.role,
                content: String(m.content).slice(-3000),
              }));
            const runData = JSON.stringify({
              conversation: turns,
              context: input.context,
              surfaces: manifest.surfaces,
              previousExpress: this.debugState.lastSuccessfulDsl.slice(-12_000),
              action,
              newSurfaceId: surfaceId,
              instruction:
                "Reply with an <a2ui> Express block. Omit surface(...) for a new view; the host selects newSurfaceId. To update an existing view, use its id with surface(id, update=true).",
            });
            if (runData.length > 28_000)
              throw new Error(
                "The local model context is too large. Reset the demo to start a smaller conversation.",
              );
            for await (const chunk of this.model.generate(
              runData,
              this.debugState.systemPrompt,
              controller.signal,
            )) {
              dsl += chunk;
              if (dsl.length > 60_000)
                throw new Error(
                  "Model output exceeded the demo limit. Try a smaller interface.",
                );
              if (performance.now() - lastPublished > 80) {
                patch({
                  dsl,
                  elapsedMs: Math.round(performance.now() - started),
                });
                lastPublished = performance.now();
              }
            }
          }
          controller.signal.throwIfAborted();
          patch({ dsl, stage: "compiling" });
          const compileStarted = performance.now();
          const operations = this.#compiler.compile(dsl, surfaceId, manifest);
          controller.signal.throwIfAborted();
          // Publish only after the entire response compiles and validates, so a
          // malformed response cannot destroy the last good preview.
          const bySurface = new Map<string, A2UIOperation[]>();
          for (const operation of operations) {
            const id = getOperationSurfaceId(operation)!;
            bySurface.set(id, [...(bySurface.get(id) ?? []), operation]);
          }
          for (const [id, surfaceOperations] of bySurface) {
            if (source !== undefined) this.#manualSurfaces.add(id);
            else this.#manualSurfaces.delete(id);
            const messageId = `express:${input.threadId}:${id}`;
            // AG-UI strips activities from RunAgentInput; the local agent's
            // canonical transcript still holds the previous surface activity.
            const previous = this.messages.find(
              (message) => message.id === messageId,
            );
            const previousOperations =
              previous?.role === "activity" &&
              Array.isArray(previous.content.operations)
                ? (previous.content.operations as A2UIOperation[])
                : [];
            emit({
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId,
              activityType: "generative-ui-surface",
              replace: true,
              content: {
                surfaceId: id,
                target: EXPRESS_TARGET,
                catalogId: manifest.catalogId,
                operations: [...previousOperations, ...surfaceOperations],
                status: "ready",
                rejected: [],
              },
            });
          }
          // The visible UI lives in surface activities. A bounded DSL context
          // is selected explicitly for follow-ups, independent of debug state.
          if (source === undefined) {
            const messageId = `express-answer:${input.runId}`;
            emit({
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              role: "assistant",
            });
            emit({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta:
                "Updated the live preview. Inspect the Express source and compiled operations in the workbench.",
            });
            emit({ type: EventType.TEXT_MESSAGE_END, messageId });
          }
          const createsView = operations.some(
            (operation) => "createSurface" in operation,
          );
          const lastSuccessfulDsl = createsView
            ? dsl
            : `${this.debugState.lastSuccessfulDsl}\n${dsl}`.slice(-12_000);
          patch({
            stage: "ready",
            dsl,
            lastSuccessfulDsl,
            operations,
            elapsedMs: Math.round(performance.now() - started),
            compileMs: Math.round(performance.now() - compileStarted),
          });
          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            patch({
              stage: "cancelled",
              elapsedMs: Math.round(performance.now() - started),
            });
            emit({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
          } else {
            patch({
              stage: "error",
              diagnostics: [errorMessage(error)],
              elapsedMs: Math.round(performance.now() - started),
            });
            emit({ type: EventType.RUN_ERROR, message: errorMessage(error) });
          }
        } finally {
          if (this.#controller === controller) this.#controller = undefined;
          observer.complete();
        }
      })();
      return () => controller.abort();
    });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
