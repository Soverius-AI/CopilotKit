import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  envelopeToManifest,
  getOperationSurfaceId,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import type { A2UIOperation, GenerativeUIManifest } from "@copilotkit/shared";
import { Observable } from "rxjs";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import type { GenerativeUI } from "@copilotkit/shared/generative-ui";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import { BrowserModel } from "./browser-model";
import type { LocalModel, ModelInfo } from "./browser-model";
import { createExpressCompiler, EXPRESS_COMPONENTS } from "./express-compiler";
import type { ExpressCompiler } from "./express-compiler";

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
  source: "model";
  model: ModelInfo | null;
  runId: string;
  surfaceId: string;
  systemPrompt: string;
  dsl: string;
  lastSuccessfulDsl: string;
  operations: A2UIOperation[];
  diagnostics: string[];
  attempt: number;
  compilerFeedback: string[];
  elapsedMs: number;
  compileMs: number;
  action: unknown;
}

export const initialDebugState = (): ExpressDebugState => ({
  availability: "checking",
  downloadProgress: 0,
  modelStarting: false,
  stage: "idle",
  source: "model",
  model: null,
  runId: "",
  surfaceId: "",
  systemPrompt: "",
  dsl: "",
  lastSuccessfulDsl: "",
  operations: [],
  diagnostics: [],
  attempt: 0,
  compilerFeedback: [],
  elapsedMs: 0,
  compileMs: 0,
  action: null,
});

/** A real AG-UI agent: only inference is supplied by Chrome instead of a server. */
export class ChromeExpressAgent extends AbstractAgent {
  #compiler?: ExpressCompiler;
  #manifest?: GenerativeUIManifest;
  #ui?: GenerativeUI;
  #controller?: AbortController;
  #enableController?: AbortController;
  #modelReady = false;
  #configuration = 0;

  constructor(private readonly model: LocalModel = new BrowserModel()) {
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
    ui: GenerativeUI,
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
      this.#ui = ui;
      this.#update({
        stage: "idle",
        availability,
        model: this.model.info,
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
          if (!controller.signal.aborted)
            this.#update({ downloadProgress, model: this.model.info });
        },
      );
      controller.signal.throwIfAborted();
      this.#modelReady = true;
      this.#update({
        availability: "enabled",
        model: this.model.info,
        modelStarting: false,
        downloadProgress: 1,
      });
    } catch (error) {
      if (this.#enableController === controller)
        this.#update({
          availability: controller.signal.aborted ? "downloadable" : "error",
          modelStarting: false,
          model: this.model.info,
          diagnostics: controller.signal.aborted ? [] : [errorMessage(error)],
        });
    }
  }

  cancel() {
    this.#controller?.abort();
    this.#enableController?.abort();
  }

  dispose() {
    ++this.#configuration;
    this.#enableController?.abort();
    this.#enableController = undefined;
    this.cancel();
    this.model.destroy();
    this.#modelReady = false;
    this.#compiler = undefined;
    this.#ui = undefined;
    this.#update({
      availability: "checking",
      modelStarting: false,
      stage: "idle",
    });
  }

  /** Replay into an isolated native manager: validate real prop types without
   * publishing anything or mutating the visible UI or user-owned values. */
  #preflight(operations: A2UIOperation[], manifest: GenerativeUIManifest) {
    if (!this.#ui) throw new Error("The native catalog is still loading.");
    const manager = new GenerativeUISurfaceManager(this.#ui, {
      onOperationRejected: ({ reason }) => {
        throw new Error(reason);
      },
    });
    manager.registerTarget(EXPRESS_TARGET, { components: EXPRESS_COMPONENTS });
    const existing = new Map<string, GenerativeUISurfaceContent>();
    for (const message of this.messages) {
      if (
        message.role === "activity" &&
        message.activityType === "generative-ui-surface"
      ) {
        const content =
          message.content as unknown as GenerativeUISurfaceContent;
        existing.set(content.surfaceId, content);
        manager.ingest(this.threadId, EXPRESS_AGENT_ID, content);
      }
    }
    const groups = new Map<string, A2UIOperation[]>();
    for (const operation of operations) {
      const id = getOperationSurfaceId(operation)!;
      groups.set(id, [...(groups.get(id) ?? []), operation]);
    }
    for (const [id, next] of groups) {
      manager.ingest(this.threadId, EXPRESS_AGENT_ID, {
        surfaceId: id,
        target: EXPRESS_TARGET,
        catalogId: manifest.catalogId,
        operations: [...(existing.get(id)?.operations ?? []), ...next],
        status: "ready",
        rejected: [],
      });
    }
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const controller = new AbortController();
      this.#controller = controller;
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
        const surfaceId = `express-${input.runId}`;
        emit({
          type: EventType.STATE_SNAPSHOT,
          snapshot: {
            ...input.state,
            a2uiExpress: {
              ...this.debugState,
              stage: "generating",
              source: "model",
              model: this.model.info,
              runId: input.runId,
              surfaceId,
              dsl: "",
              operations: [],
              diagnostics: [],
              attempt: 0,
              compilerFeedback: [],
              elapsedMs: 0,
              compileMs: 0,
              action,
            },
          },
        });
        try {
          if (!this.#compiler || !manifest)
            throw new Error("The Express catalog is still loading.");
          if (!this.#modelReady)
            throw new Error("Enable the browser model before generating.");
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
          const requestData = {
            conversation: turns,
            context: input.context,
            surfaces: manifest.surfaces,
            previousExpress: this.debugState.lastSuccessfulDsl.slice(-12_000),
            action,
            newSurfaceId: surfaceId,
            instruction: action
              ? "Respond to the current action using its actual values. Update the action surface with surface(id, update=true). Preserve all existing input values. Do not restart the original creation request or create a duplicate form. Reply with a complete <a2ui> Express block."
              : "Reply with an <a2ui> Express block. Omit surface(...) for a new view; the host selects newSurfaceId. To update an existing view, use its id with surface(id, update=true).",
          };
          let dsl = "";
          let operations: A2UIOperation[] = [];
          let compileStarted = performance.now();
          let rejectedDsl = "";
          const compilerFeedback: string[] = [];
          for (let attempt = 1; attempt <= 3; attempt++) {
            controller.signal.throwIfAborted();
            dsl = "";
            patch({
              attempt,
              stage: "generating",
              dsl,
            });
            const runData = JSON.stringify({
              ...requestData,
              ...(compilerFeedback.length
                ? {
                    conversation: [
                      ...(requestData.conversation as {
                        role: string;
                        content: string;
                      }[]),
                      {
                        role: "assistant",
                        content: rejectedDsl.slice(0, 12_000),
                      },
                      {
                        role: "user",
                        content: `The Express compiler rejected your response: ${compilerFeedback.at(-1)}\nReturn a complete corrected <a2ui> block for the original request. Correct every invalid constructor or argument. Constructor names are case-sensitive: ${EXPRESS_COMPONENTS.join(", ")}. Use CheckBox, not Checkbox; gap, not spacing. Button color is primary, secondary, or danger; omit it for the default. Put form fields in Form with Event as its second argument and a submit=true Button. Declare variables outside child arrays. Do not repeat positional arguments as named arguments. Do not explain the correction.`,
                      },
                    ],
                  }
                : {}),
            });
            if (runData.length > 28_000)
              throw new Error(
                "The local model context is too large. Reset the demo to start a smaller conversation.",
              );
            let lastPublished = 0;
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
            controller.signal.throwIfAborted();
            patch({ dsl, stage: "compiling" });
            compileStarted = performance.now();
            try {
              operations = this.#compiler.compile(dsl, surfaceId, manifest);
              this.#preflight(operations, manifest);
              break;
            } catch (error) {
              const diagnostic = errorMessage(error);
              compilerFeedback.push(`Attempt ${attempt}: ${diagnostic}`);
              rejectedDsl = dsl;
              patch({
                compilerFeedback: [...compilerFeedback],
                diagnostics: [diagnostic],
              });
              if (attempt === 3) throw error;
            }
          }
          controller.signal.throwIfAborted();
          // Publish only after the entire response compiles and validates, so a
          // malformed response cannot destroy the last good preview.
          const bySurface = new Map<string, A2UIOperation[]>();
          for (const operation of operations) {
            const id = getOperationSurfaceId(operation)!;
            bySurface.set(id, [...(bySurface.get(id) ?? []), operation]);
          }
          for (const [id, surfaceOperations] of bySurface) {
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
          {
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
            diagnostics: [],
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
            this.#modelReady = false;
            this.model.destroy();
            patch({
              availability: "downloadable",
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
