import {
  AbstractAgent,
  EventType,
  withAuthoritativeActivityTypes,
} from "@ag-ui/client";
import type {
  BaseEvent,
  Message,
  MessagesSnapshotEvent,
  RunAgentInput,
} from "@ag-ui/client";
import {
  envelopeToManifest,
  getOperationSurfaceId,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import type { A2UIOperation, GenerativeUIManifest } from "@copilotkit/shared";
import { Observable } from "rxjs";
import type { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import { BrowserModel, FallbackSelectedError } from "./browser-model";
import type { BrowserModelMode } from "./browser-model";
import type { LocalModel, ModelInfo } from "./browser-model";
import { ExpressCompiler, operationsOf } from "./express-compiler";
import {
  actionTurn,
  creationTurn,
  lineRepairTurn,
  repairTurn,
  rootChildren,
  rootLineWith,
} from "./model-request";
import type { Turn, ViewSource } from "./model-request";

export const EXPRESS_AGENT_ID = "a2ui-1.0";
export const EXPRESS_TARGET = "express-preview";
const SURFACE_ACTIVITY = "generative-ui-surface";
/** How often streamed operations are published to the preview. */
export const PREVIEW_INTERVAL_MS = 150;
/** Rejected lines the model may correct in one response before it writes
 * the whole block again. */
export const LINE_FIXES = 3;

const surfaceMessageId = (threadId: string, surfaceId: string) =>
  `express:${threadId}:${surfaceId}`;

/** The short id the host gives the next new view: one past the highest
 * view-N among existing, deleted and failed surfaces, so no id is reused. */
export function nextViewId(taken: Iterable<string>) {
  let highest = 0;
  for (const id of taken) {
    const match = /^view-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `view-${highest + 1}`;
}

/** Surfaces that exist now: not deleted, and not failed to create. */
function liveSurfaceIds(manifest: GenerativeUIManifest) {
  return Object.entries(manifest.surfaces)
    .filter(([, s]) => s.status !== "deleted" && s.status !== "failed")
    .map(([id]) => id);
}

/**
 * Whether the native surface manager would take `next` for an extension of
 * `previous`, the list it applied last, when it is not one. It compares only
 * the last operation it applied, so it would skip a changed earlier one.
 */
export function hidesChange(
  previous: readonly A2UIOperation[],
  next: readonly A2UIOperation[],
) {
  if (!previous.length || next.length < previous.length) return false;
  const same = (index: number) =>
    JSON.stringify(previous[index]) === JSON.stringify(next[index]);
  return (
    same(previous.length - 1) &&
    previous.slice(0, -1).some((_, index) => !same(index))
  );
}

/** The operations of each surface, in order. */
function bySurface(operations: A2UIOperation[]) {
  const groups = new Map<string, A2UIOperation[]>();
  for (const operation of operations) {
    const id = getOperationSurfaceId(operation)!;
    groups.set(id, [...(groups.get(id) ?? []), operation]);
  }
  return groups;
}

/**
 * The page's half of withdrawing a preview: an express-preview surface of
 * the thread whose activity message the agent took back never became a
 * view, so the native manager forgets it. Call it whenever the agent's
 * messages change. The manager keeps any surface that was ready once.
 */
export function discardWithdrawnPreviews(
  manager: GenerativeUISurfaceManager,
  threadId: string,
  messages: readonly Message[],
) {
  const kept = new Set(
    messages.flatMap((message) =>
      message.role === "activity" && message.activityType === SURFACE_ACTIVITY
        ? [(message.content as { surfaceId?: unknown }).surfaceId]
        : [],
    ),
  );
  for (const surface of manager.debugSurfaces())
    if (
      surface.threadId === threadId &&
      surface.target === EXPRESS_TARGET &&
      !kept.has(surface.surfaceId)
    )
      manager.discardSurface(threadId, surface.surfaceId);
}

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
    | "answered"
    | "error"
    | "cancelled";
  source: "model";
  model: ModelInfo | null;
  runId: string;
  surfaceId: string;
  systemPrompt: string;
  /** The request turn of the first attempt, exactly as the model reads it. */
  modelRequest: string;
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

/** Application knowledge about what an action means. It joins the run's
 * context only when a matching action is being answered, never while a view
 * is being created. */
export interface ActionGuidance {
  description: string;
  value: string;
  /** The model names events, so match on the actual action name. `origin`
   * is the request the action's view was built for, for generic names such
   * as "review". */
  matches: (actionName: string, origin?: string) => boolean;
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
  modelRequest: "",
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
  #controller?: AbortController;
  #enableController?: AbortController;
  #modelReady = false;
  #configuration = 0;
  #actionGuidance: ActionGuidance[] = [];
  /** The Express each published view was built from, for follow-up edits. */
  #sources = new Map<string, string>();
  /** The user requests each published view was built from, so an action
   * answer knows facts such as a total that no submitted value holds. */
  #requests = new Map<string, string>();

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
    actionGuidance: ActionGuidance[] = [],
  ) {
    const configuration = ++this.#configuration;
    this.#update({ stage: "preparing", diagnostics: [] });
    try {
      const compiler = new ExpressCompiler(schema);
      const availability = await this.model
        .availability()
        .catch(() => "unavailable");
      if (configuration !== this.#configuration) return;
      this.#compiler = compiler;
      this.#manifest = manifest;
      this.#actionGuidance = actionGuidance;
      this.#update({
        stage: "idle",
        availability,
        model: this.model.info,
        systemPrompt: compiler.systemPrompt,
      });
    } catch (error) {
      if (configuration === this.#configuration)
        this.#update({ stage: "error", diagnostics: [errorMessage(error)] });
    }
  }

  async enable() {
    const compiler = this.#compiler;
    if (!compiler) return;
    this.#enableController?.abort();
    const controller = new AbortController();
    this.#enableController = controller;
    this.#modelReady = false;
    // Every generation of this session reads the same state.systemPrompt.
    const systemPrompt = compiler.systemPrompt;
    this.#update({
      availability: "downloading",
      modelStarting: true,
      diagnostics: [],
      systemPrompt,
    });
    try {
      await this.model.enable(
        systemPrompt,
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
      if (this.#enableController !== controller) return;
      // After Stop, or once the fallback is selected but not yet loaded, ask
      // the engine again: an installed Chrome model is not "downloadable".
      const availability =
        controller.signal.aborted || error instanceof FallbackSelectedError
          ? await this.model.availability().catch(() => "unavailable")
          : "error";
      if (this.#enableController === controller)
        this.#update({
          availability,
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

  selectModel(mode: BrowserModelMode) {
    this.dispose();
    if (this.model instanceof BrowserModel) this.model.selectMode(mode);
  }

  dispose() {
    ++this.#configuration;
    this.#enableController?.abort();
    this.#enableController = undefined;
    this.cancel();
    this.model.destroy();
    this.#modelReady = false;
    this.#compiler = undefined;
    this.#sources.clear();
    this.#requests.clear();
    this.#update({
      availability: "checking",
      modelStarting: false,
      stage: "idle",
    });
  }

  /** The published surface activities of this agent's transcript. */
  #surfaceActivities(): GenerativeUISurfaceContent[] {
    return this.messages.flatMap((message) =>
      message.role === "activity" &&
      message.activityType === "generative-ui-surface"
        ? [message.content as unknown as GenerativeUISurfaceContent]
        : [],
    );
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const controller = new AbortController();
      this.#controller = controller;
      const configuration = this.#configuration;
      /** Disposing the agent, moving to another thread or starting another
       * run makes a run stale: nothing of it may reach the newer session. */
      const isCurrent = () =>
        configuration === this.#configuration &&
        this.#controller === controller &&
        this.threadId === input.threadId;
      const emit = (event: Record<string, unknown>) => {
        if (!observer.closed) observer.next(event as BaseEvent);
      };
      // A detached run (its subscriber left early) still reports its end.
      const patch = (value: Partial<ExpressDebugState>) => {
        if (observer.closed) {
          if (isCurrent()) this.#update(value);
          return;
        }
        emit({
          type: EventType.STATE_DELTA,
          delta: Object.entries(value).map(([key, item]) => ({
            op: "replace",
            path: `/a2uiExpress/${key}`,
            value: item,
          })),
        });
      };
      // The transcript and its surfaces as committed before this run. Every
      // preview of the run is published on top of them, and withdrawn by
      // going back to them.
      const startMessages = structuredClone(this.messages);
      const committed = new Map<string, GenerativeUISurfaceContent>();
      for (const message of startMessages)
        if (
          message.role === "activity" &&
          message.activityType === SURFACE_ACTIVITY
        )
          committed.set(
            message.id,
            message.content as unknown as GenerativeUISurfaceContent,
          );
      /** The operations this run last published, by activity message. */
      const published = new Map<string, A2UIOperation[]>();
      let previewShown = false;
      const publish = (
        messageId: string,
        content: GenerativeUISurfaceContent,
      ) => {
        const base = committed.get(messageId)?.operations ?? [];
        const previous = published.get(messageId) ?? base;
        const snapshot = (operations: A2UIOperation[]) =>
          emit({
            type: EventType.ACTIVITY_SNAPSHOT,
            messageId,
            activityType: SURFACE_ACTIVITY,
            replace: true,
            content: { ...content, operations },
          });
        // A shorter list makes the manager rebuild the surface, user-owned
        // values included, instead of skipping the change.
        if (hidesChange(previous, content.operations)) snapshot(base);
        snapshot(content.operations);
        published.set(messageId, content.operations);
      };
      /** Takes back every preview of this run: the transcript, and with it
       * the surfaces, return to how they were committed. A new view leaves
       * no activity behind, and the page forgets its surface. */
      const withdraw = () => {
        if (!published.size) return;
        published.clear();
        if (!isCurrent()) return;
        if (!observer.closed)
          emit(
            withAuthoritativeActivityTypes(
              {
                type: EventType.MESSAGES_SNAPSHOT,
                messages: structuredClone(startMessages),
              } as MessagesSnapshotEvent,
              [SURFACE_ACTIVITY],
            ) as unknown as Record<string, unknown>,
          );
        else this.setMessages(structuredClone(startMessages));
        patch({ operations: [] });
      };
      /** The preview due at the end of the interval while the model is
       * silent, so the latest output appears even if no chunk follows. */
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const clearFlush = () => {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      };
      controller.signal.addEventListener("abort", clearFlush, { once: true });
      /** Set once the run commits its outcome: leaving then takes nothing
       * back. */
      let settled = false;
      const say = (kind: "answer" | "ui" | "status", text: string) => {
        const messageId = `express-${kind}:${input.runId}`;
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        });
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: text,
        });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      };
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
        const actionEvent = (
          action as {
            action?: { name?: unknown; surfaceId?: unknown; context?: unknown };
          } | null
        )?.action;
        const actionScope =
          typeof actionEvent?.name === "string" &&
          typeof actionEvent.surfaceId === "string"
            ? { name: actionEvent.name, surfaceId: actionEvent.surfaceId }
            : undefined;
        // The compiler default for a block without surface(...): a short id
        // a small model copies reliably, never one that existed before.
        const newSurfaceId = nextViewId([
          ...Object.keys(manifest?.surfaces ?? {}),
          ...this.#surfaceActivities().map((content) => content.surfaceId),
        ]);
        const surfaceId = actionScope?.surfaceId ?? newSurfaceId;
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
              modelRequest: "",
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
          // Surface data and application context are run data, never system
          // instructions. Failure and Stop notices are for the user, and the
          // canned "Updated the live preview" notes would teach the model to
          // answer in prose, so neither reaches it; the views' Express does.
          const turns: Turn[] = input.messages
            .filter(
              (m) =>
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string" &&
                !m.id.startsWith("express-status:") &&
                !m.id.startsWith("express-ui:"),
            )
            .map((m) => ({
              role: m.role as Turn["role"],
              content: String(m.content),
            }));
          const context = input.context.map(({ description, value }) => ({
            description,
            value,
          }));
          const compiler = this.#compiler;
          /** A view on the page, the Express it was built from and the
           * user's current values. */
          const viewOf = (id: string): ViewSource[] => {
            const source = this.#sources.get(id);
            return source
              ? [{ id, source, values: manifest.surfaces[id]?.dataModel }]
              : [];
          };
          let userRequest = "";
          let request: string;
          if (actionScope) {
            const origin = this.#requests.get(actionScope.surfaceId);
            const submitted = actionEvent?.context;
            const operations =
              this.#surfaceActivities().find(
                (content) => content.surfaceId === actionScope.surfaceId,
              )?.operations ?? [];
            const components = operations.flatMap(
              (operation) =>
                ("createSurface" in operation
                  ? operation.createSurface.components
                  : "updateComponents" in operation
                    ? operation.updateComponents.components
                    : undefined) ?? [],
            );
            // A fresh name for the outcome, so it never replaces a component.
            let resultName = "result";
            for (
              let n = 2;
              components.some(
                ({ id }) =>
                  id === resultName || id.startsWith(`${resultName}_`),
              );
              n++
            )
              resultName = `result_${n}`;
            // Only names the model wrote itself, not generated inline ids.
            const source = this.#sources.get(actionScope.surfaceId) ?? "";
            request = actionTurn({
              name: actionScope.name,
              surfaceId: actionScope.surfaceId,
              values:
                submitted && typeof submitted === "object"
                  ? (submitted as Record<string, unknown>)
                  : (manifest.surfaces[actionScope.surfaceId]?.dataModel ?? {}),
              // Guidance about an action's outcome joins the request only
              // while that action is answered, so it cannot shape the first
              // view.
              guidance: this.#actionGuidance
                .filter((entry) => entry.matches(actionScope.name, origin))
                .map(({ description, value }) => ({ description, value })),
              context,
              existingTypes: Object.fromEntries(
                components
                  .filter(({ id }) => id !== "root")
                  .map(({ id, component }) => [id, component]),
              ),
              keep: rootChildren(operations).filter((id) =>
                new RegExp(`^${id} =`, "m").test(source),
              ),
              rootLine: rootLineWith(operations, resultName),
              resultName,
            });
          } else {
            let lastUser = turns.length - 1;
            while (lastUser >= 0 && turns[lastUser]!.role !== "user")
              lastUser--;
            userRequest = turns[lastUser]?.content.slice(-3000) ?? "";
            request = creationTurn({
              request: userRequest,
              earlier: turns
                .slice(0, Math.max(lastUser, 0))
                .slice(-4)
                .map((turn) => ({
                  ...turn,
                  content: turn.content.slice(0, 400),
                })),
              context,
              views: liveSurfaceIds(manifest).slice(-2).flatMap(viewOf),
              newSurfaceId,
            });
          }
          patch({ modelRequest: request });
          /** The renderer state every response is checked against. */
          const committedOperations = [...committed.values()].flatMap(
            (content) => content.operations,
          );
          /** The host's new view, open before the model writes its root. The
           * SDK stream then emits a root-last view statement by statement,
           * as CopilotKit's surface writer opens a surface before its
           * components. */
          const opening = {
            // The A2UI 1.0 wire value, as the SDK writes its own messages.
            version: "1.0",
            createSurface: {
              surfaceId: newSurfaceId,
              catalogId: manifest.catalogId,
            },
          } as unknown as A2UIOperation;
          /** One inference, to its end. */
          const generate = async (
            turn: string,
            onChunk?: (chunk: string) => void,
          ) => {
            let text = "";
            for await (const chunk of this.model.generate(
              turn,
              this.debugState.systemPrompt,
              controller.signal,
            )) {
              // A chunk that arrives after Stop or a reset is never shown.
              if (!isCurrent()) controller.abort();
              controller.signal.throwIfAborted();
              text += chunk;
              if (text.length > 60_000)
                throw new Error(
                  "Model output exceeded the demo limit. Try a smaller interface.",
                );
              onChunk?.(chunk);
            }
            if (!isCurrent()) controller.abort();
            controller.signal.throwIfAborted();
            return text;
          };
          const userTurn = (content: string) =>
            JSON.stringify({ conversation: [{ role: "user", content }] });
          let dsl = "";
          let operations: A2UIOperation[] = [];
          let answer: string | undefined;
          let compileStarted = performance.now();
          let rejectedDsl = "";
          let diagnostic = "";
          let contents = new Map<string, GenerativeUISurfaceContent>();
          const compilerFeedback: string[] = [];
          /** Shows the operations the SDK has read so far, on top of each
           * surface's committed ones. */
          const preview = (streamed: A2UIOperation[]) => {
            const changed = [...bySurface(streamed)].flatMap(
              ([id, group]): [string, GenerativeUISurfaceContent][] => {
                const messageId = surfaceMessageId(input.threadId, id);
                const surfaceOperations = [
                  ...(committed.get(messageId)?.operations ?? []),
                  ...(id === newSurfaceId ? [opening] : []),
                  ...group,
                ];
                return JSON.stringify(published.get(messageId)) ===
                  JSON.stringify(surfaceOperations)
                  ? []
                  : [
                      [
                        messageId,
                        {
                          surfaceId: id,
                          target: EXPRESS_TARGET,
                          catalogId: manifest.catalogId,
                          operations: surfaceOperations,
                          status: "streaming",
                          rejected: [],
                        },
                      ],
                    ];
              },
            );
            if (!changed.length) return;
            for (const [messageId, content] of changed)
              publish(messageId, content);
            previewShown = true;
            patch({ operations: streamed });
          };
          for (let attempt = 1; attempt <= 3; attempt++) {
            controller.signal.throwIfAborted();
            dsl = "";
            patch({
              attempt,
              stage: "generating",
              dsl,
            });
            // One request turn; a whole-block repair adds the rejected draft
            // and its diagnostic.
            const runData = JSON.stringify({
              conversation: [
                { role: "user", content: request },
                ...(diagnostic
                  ? [
                      {
                        role: "assistant",
                        content: rejectedDsl.slice(0, 12_000) || "(no reply)",
                      },
                      { role: "user", content: repairTurn(diagnostic) },
                    ]
                  : []),
              ],
            });
            if (runData.length > 28_000)
              throw new Error(
                "The local model context is too large. Reset the demo to start a smaller conversation.",
              );
            // The SDK reads the response as it streams. Once it rejects a
            // block the stream ends, and the last preview stays: a new view
            // ends there at its root line, which would create it again.
            let stream: ReturnType<ExpressCompiler["stream"]> | undefined =
              compiler.stream(newSurfaceId, [...committedOperations, opening]);
            const streamed: A2UIOperation[] = [];
            let lastPublished = 0;
            let lastPreview = performance.now();
            const flush = () => {
              clearFlush();
              preview(streamed);
              lastPreview = performance.now();
            };
            try {
              dsl = await generate(runData, (chunk) => {
                dsl += chunk;
                if (performance.now() - lastPublished > 80) {
                  patch({
                    dsl,
                    elapsedMs: Math.round(performance.now() - started),
                  });
                  lastPublished = performance.now();
                }
                try {
                  streamed.push(...operationsOf(stream?.feed(chunk) ?? []));
                } catch {
                  stream = undefined;
                }
                // Publishing every chunk would stall the page, so a chunk
                // inside the interval waits for its end, even if the model
                // then goes silent.
                const wait =
                  PREVIEW_INTERVAL_MS - (performance.now() - lastPreview);
                if (wait <= 0) flush();
                else
                  flushTimer ??= setTimeout(() => {
                    flushTimer = undefined;
                    if (isCurrent() && !controller.signal.aborted) flush();
                  }, wait);
              });
            } finally {
              // The whole response is checked below: a pending preview must
              // never land on the final or the withdrawn UI.
              clearFlush();
            }
            patch({ dsl, stage: "compiling" });
            compileStarted = performance.now();
            let source = dsl;
            try {
              // Express error recovery: the model corrects only the rejected
              // line, the correction is swapped into the block, and the whole
              // response is checked again.
              let parsed: ReturnType<ExpressCompiler["parse"]> | undefined;
              let fixes = 0;
              while (!parsed) {
                try {
                  parsed = compiler.parse(
                    source,
                    newSurfaceId,
                    committedOperations,
                  );
                } catch (error) {
                  const line =
                    fixes++ < LINE_FIXES
                      ? compiler.invalidLine(error)
                      : undefined;
                  if (!line) throw error;
                  const lineDiagnostic = errorMessage(error);
                  const correction = await generate(
                    userTurn(
                      lineRepairTurn({
                        line: line.text,
                        diagnostic: lineDiagnostic,
                      }),
                    ),
                  );
                  compilerFeedback.push(
                    `Attempt ${attempt}, line ${line.index + 1}: ${lineDiagnostic} Corrected: ${correction.trim()}`,
                  );
                  patch({
                    compilerFeedback: [...compilerFeedback],
                    diagnostics: [lineDiagnostic],
                  });
                  const swapped = compiler.hotSwap(source, line, correction);
                  if (swapped === undefined) throw error;
                  source = swapped;
                  patch({ dsl: source });
                }
              }
              dsl = source;
              if (!parsed.operations.length) {
                // Prose answers a message, never an action or a rejected
                // draft.
                if (parsed.text && !action && !diagnostic) {
                  answer = parsed.text;
                  break;
                }
                throw new Error("The reply has no <a2ui> block.");
              }
              operations = parsed.operations;
              // Each surface's committed operations and this answer's: what
              // is checked here is exactly what is published.
              contents = new Map(
                [...bySurface(operations)].map(
                  ([id, group]): [string, GenerativeUISurfaceContent] => {
                    const messageId = surfaceMessageId(input.threadId, id);
                    return [
                      messageId,
                      {
                        surfaceId: id,
                        target: EXPRESS_TARGET,
                        catalogId: manifest.catalogId,
                        operations: [
                          ...(committed.get(messageId)?.operations ?? []),
                          ...group,
                        ],
                        status: "ready",
                        rejected: [],
                      },
                    ];
                  },
                ),
              );
              break;
            } catch (error) {
              diagnostic = errorMessage(error);
              compilerFeedback.push(`Attempt ${attempt}: ${diagnostic}`);
              rejectedDsl = source;
              // The rejected draft leaves the preview before its repair
              // streams: the user sees the last validated UI meanwhile.
              withdraw();
              patch({
                compilerFeedback: [...compilerFeedback],
                diagnostics: [diagnostic],
              });
              if (attempt === 3) throw new InvalidOutputError(diagnostic);
            }
          }
          if (!isCurrent()) controller.abort();
          controller.signal.throwIfAborted();
          settled = true;
          if (answer !== undefined) {
            // A prose reply publishes no UI and is not counted as a render.
            withdraw();
            say("answer", answer);
            patch({
              stage: "answered",
              diagnostics: [],
              dsl,
              operations: [],
              elapsedMs: Math.round(performance.now() - started),
              compileMs: 0,
            });
            emit({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
            return;
          }
          // Commit the entire validated response: each surface becomes its
          // committed operations plus this answer's, replacing its preview,
          // so no preview operation stays in the transcript. A preview of a
          // surface the answer leaves alone, from an earlier draft, is
          // withdrawn first.
          if ([...published.keys()].some((id) => !contents.has(id))) withdraw();
          for (const [messageId, content] of contents)
            publish(messageId, content);
          for (const [id, surfaceOperations] of bySurface(operations)) {
            // A follow-up edit sees each view's own Express, bounded,
            // without the transport tags.
            const block = dsl.replace(/<\/?a2ui>/g, "").trim();
            this.#sources.set(
              id,
              surfaceOperations.some(
                (operation) => "createSurface" in operation,
              )
                ? block.slice(-6000)
                : `${this.#sources.get(id) ?? ""}\n${block}`
                    .trim()
                    .slice(-6000),
            );
            // An edit adds to the request a view was built for; an action
            // answer does not change it.
            if (userRequest)
              this.#requests.set(
                id,
                surfaceOperations.some(
                  (operation) => "createSurface" in operation,
                )
                  ? userRequest.slice(-800)
                  : `${this.#requests.get(id) ?? ""}\nThen: ${userRequest}`
                      .trim()
                      .slice(-800),
              );
          }
          // The visible UI lives in surface activities; this note is for the
          // user only and never goes back to the model.
          say(
            "ui",
            "Updated the live preview. Inspect the Express source and compiled operations in the workbench.",
          );
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
          const elapsedMs = Math.round(performance.now() - started);
          if (!isCurrent()) {
            // Disposed or reset: the new session gets nothing from this run.
            emit({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
            return;
          }
          // Back to the last validated UI: no partly built view is left.
          withdraw();
          const outcome = previewShown
            ? "its partial preview was withdrawn"
            : "nothing was published";
          if (controller.signal.aborted) {
            this.#modelReady = false;
            this.model.destroy();
            // Stopping releases the session, not an installed model. A model
            // enabled meanwhile keeps the availability it reported.
            const enabling = this.#enableController;
            const availability = await this.model
              .availability()
              .catch(() => "unavailable");
            if (!isCurrent()) {
              emit({
                type: EventType.RUN_FINISHED,
                threadId: input.threadId,
                runId: input.runId,
              });
              return;
            }
            say(
              "status",
              `Stopped. ${previewShown ? "The partial preview from this run was withdrawn" : "Nothing from this run was published"}, so the preview and the values you entered are unchanged. Enable the local model again to continue.`,
            );
            patch({
              ...(this.#enableController === enabling ? { availability } : {}),
              stage: "cancelled",
              elapsedMs,
            });
            emit({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
          } else {
            const message = errorMessage(error);
            say(
              "status",
              error instanceof InvalidOutputError
                ? `I could not produce a valid interface in 3 attempts, so ${outcome}. The previous preview and the values you entered are unchanged. Last problem: ${message} Try again, or ask for a smaller or simpler interface. Agent state lists every attempt.`
                : `The local model run failed: ${message} ${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}; the previous preview and the values you entered are unchanged.`,
            );
            patch({ stage: "error", diagnostics: [message], elapsedMs });
            emit({ type: EventType.RUN_ERROR, message });
          }
        } finally {
          clearFlush();
          if (this.#controller === controller) this.#controller = undefined;
          observer.complete();
        }
      })();
      // Leaving early takes the preview back at once: a newer run may start
      // before the model notices, and this run may not touch that one.
      return () => {
        controller.abort();
        if (!settled) withdraw();
      };
    });
  }
}

/** Every attempt produced output the compiler rejected. */
class InvalidOutputError extends Error {}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
