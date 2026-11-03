import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/client";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { BrowserModel } from "./browser-model";
import type { LocalModel } from "./browser-model";
import {
  ChromeExpressAgent,
  discardWithdrawnPreviews,
  EXPRESS_TARGET,
  hidesChange,
  LINE_FIXES,
  nextViewId,
  PREVIEW_INTERVAL_MS,
} from "./chrome-express-agent";
import type { ActionGuidance } from "./chrome-express-agent";
import { ChromeModel } from "./chrome-model";
import { ExpressCompiler, EXPRESS_COMPONENTS } from "./express-compiler";
import { EXPRESS_EXAMPLES } from "./express-examples";
import { lineRepairTurn, repairTurn } from "./model-request";
import { testManifest, testUI } from "./test-catalog";

const block = (source: string) => `<a2ui>\n${source}\n</a2ui>`;
/** The request turn the model read: the first user turn of an input. */
const request = (input: string): string =>
  JSON.parse(input).conversation[0].content;
/** The last turn of an input, and the rejected draft before it. */
const lastTurn = (input: string): string =>
  JSON.parse(input).conversation.at(-1).content;
const rejectedOf = (input: string): string =>
  JSON.parse(input).conversation.at(-2).content;

class TestModel extends ChromeModel {
  output = block(EXPRESS_EXAMPLES.form);
  /** Responses for the next generations, before `output` applies. */
  queue: string[] = [];
  inputs: string[] = [];
  enabledPrompt = "";
  override async availability(): Promise<Availability> {
    return "available";
  }
  override async enable(prompt: string) {
    this.enabledPrompt = prompt;
  }
  override async *generate(input: string, prompt: string, signal: AbortSignal) {
    this.inputs.push(input);
    expect(prompt).toBe(this.enabledPrompt);
    signal.throwIfAborted();
    yield this.queue.shift() ?? this.output;
  }
  override destroy() {}
}

/** The CopilotKit UI envelope that names an existing surface, with the
 * user-owned values the page reports for it. */
function uiEnvelope(
  surfaceId: string,
  action?: unknown,
  dataModel?: Record<string, unknown>,
) {
  return {
    copilotkit: {
      ui: {
        "v1.0": {
          supportedCatalogIds: [testUI.id],
          inlineCatalogs: [
            {
              catalogId: testUI.id,
              protocolVersion: "1.0",
              components: testManifest.components,
              functions: {},
            },
          ],
        },
        metadata: {
          extensions: {
            copilotkit_format: 3,
            copilotkit_transport: "tool",
            copilotkit_targets: testManifest.targets,
            copilotkit_surfaces: {
              [surfaceId]: {
                target: "express-preview",
                ...(dataModel ? { dataModel } : {}),
              },
            },
            copilotkit_contextSent: false,
            ...(action ? { copilotkit_action: action } : {}),
          },
        },
      },
    },
  };
}

const registerAction = (context: Record<string, unknown>) => ({
  version: "v1.0",
  action: {
    name: "register",
    surfaceId: "view-1",
    sourceComponentId: "form",
    timestamp: "2026-11-02T12:00:00.000Z",
    context,
  },
});

const activities = (agent: ChromeExpressAgent) =>
  agent.messages.filter((message) => message.role === "activity");
const assistantText = (agent: ChromeExpressAgent) =>
  agent.messages
    .filter((message) => message.role === "assistant")
    .map((message) => String(message.content));

async function configured(
  model = new TestModel(),
  guidance: ActionGuidance[] = [],
) {
  const agent = new ChromeExpressAgent(model);
  await agent.configure(exportA2UICatalog(testUI), testManifest, guidance);
  agent.setState({ ...agent.state, unrelated: "preserved" });
  agent.addMessage({
    id: "request",
    role: "user",
    content: "Create a registration form",
  });
  return { agent, model };
}

describe("browser-local CopilotKit agent", () => {
  it("requires model enablement and has no preset execution path", async () => {
    const { agent, model } = await configured();
    await agent.runAgent();
    expect(agent.debugState.stage).toBe("error");
    expect(activities(agent)).toEqual([]);
    expect(model.inputs).toEqual([]);
    expect(assistantText(agent)).toEqual([
      "The local model run failed: Enable the browser model before generating. Nothing was published; the previous preview and the values you entered are unchanged.",
    ]);
  });

  it("guides the model with the SDK prompt and publishes what the SDK compiled", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    const events: string[] = [];
    await agent.runAgent(
      {},
      {
        onStateSnapshotEvent: ({ event }) => void events.push(event.type),
        onStateDeltaEvent: ({ event }) => void events.push(event.type),
        onActivitySnapshotEvent: ({ event }) => void events.push(event.type),
      },
    );
    expect(events).toEqual(
      expect.arrayContaining([
        "STATE_SNAPSHOT",
        "STATE_DELTA",
        "ACTIVITY_SNAPSHOT",
      ]),
    );
    const compiler = new ExpressCompiler(exportA2UICatalog(testUI));
    expect(model.enabledPrompt).toBe(compiler.systemPrompt);
    expect(request(model.inputs[0]!)).toMatch(
      /^Request: Create a registration form\n\n[\s\S]*No view exists yet\. Write no surface\(\.\.\.\) line: the page creates this view as view-1\.$/,
    );
    // The workbench shows exactly what the model read.
    expect(agent.debugState.modelRequest).toBe(request(model.inputs[0]!));
    expect(agent.state.unrelated).toBe("preserved");
    expect(agent.debugState).toMatchObject({
      stage: "ready",
      attempt: 1,
      compilerFeedback: [],
      operations: compiler.parse(model.output, "view-1").operations,
    });
    expect(activities(agent)).toHaveLength(1);
    expect(activities(agent)[0]!.content.operations).toEqual(
      agent.debugState.operations,
    );
  });

  it("names new views view-1, view-2, and skips ids the page already used", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    await agent.runAgent();
    expect(agent.debugState.surfaceId).toBe("view-1");
    agent.addMessage({ id: "card", role: "user", content: "A second card" });
    model.output = block(EXPRESS_EXAMPLES.card);
    await agent.runAgent();
    expect(agent.debugState.operations[0]).toMatchObject({
      createSurface: { surfaceId: "view-2" },
    });
    // A deleted view-3 keeps its id taken.
    const envelope = uiEnvelope("view-1");
    envelope.copilotkit.ui.metadata.extensions.copilotkit_surfaces = {
      "view-1": { target: "express-preview" },
      "view-3": { target: "express-preview", status: "deleted" },
    } as never;
    agent.addMessage({ id: "third", role: "user", content: "One more" });
    await agent.runAgent({ forwardedProps: envelope });
    expect(agent.debugState.surfaceId).toBe("view-4");
    expect(nextViewId(["view-2", "other", "view-9"])).toBe("view-10");
  });

  it("answers an action in its view with the submitted values, and keeps the others", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    await agent.runAgent();
    model.output = block(
      `surface("view-1", update=true)\n$/status = "Registered"\nstatus = Text($/status)\nroot = Card([heading, price, form, status], gap=3)`,
    );
    const action = registerAction({ name: "Ada Lovelace" });
    await agent.runAgent({
      forwardedProps: uiEnvelope("view-1", action, { "/name": "Ada Lovelace" }),
    });
    const answer = request(model.inputs[1]!);
    expect(answer).toContain(
      'ACTION: the user submitted "register" from view-1.',
    );
    expect(answer).toContain('- name: "Ada Lovelace"');
    // The view's real root, written back with the outcome added.
    expect(answer).toContain(
      "End with exactly this line, which keeps everything view-1 shows and adds result:\nroot = Card(children=[heading, price, form, result], gap=3)",
    );
    expect(answer).toContain("- form: Form");
    expect(agent.debugState).toMatchObject({ stage: "ready", action });
    expect(activities(agent)).toHaveLength(1);
    // Each data path is written on its own, so no other value is reset.
    expect(agent.debugState.operations.at(-1)).toEqual({
      version: "1.0",
      updateDataModel: {
        surfaceId: "view-1",
        path: "/status",
        value: "Registered",
      },
    });
  });

  it("adds the app's guidance only while a matching action is answered", async () => {
    const guidance: ActionGuidance = {
      description: "Registration",
      value: "Confirm the seat.",
      matches: (name) => name === "register",
    };
    const { agent, model } = await configured(new TestModel(), [guidance]);
    await agent.enable();
    await agent.runAgent();
    expect(model.inputs[0]).not.toContain("Confirm the seat.");
    model.output = block(
      `surface("view-1", update=true)\nseat = Text("Seat confirmed")\nroot = Card([heading, price, form, seat])`,
    );
    await agent.runAgent({
      forwardedProps: uiEnvelope("view-1", registerAction({})),
    });
    expect(request(model.inputs[1]!)).toContain(
      'What the app wants for "register": Confirm the seat.',
    );
  });

  it("cancels before publication and requires re-enabling the released model", async () => {
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    class SlowModel extends TestModel {
      override async *generate(
        _input: string,
        _prompt: string,
        signal: AbortSignal,
      ) {
        yield "<a2ui>";
        started();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        signal.throwIfAborted();
      }
    }
    const { agent } = await configured(new SlowModel());
    await agent.enable();
    const running = agent.runAgent();
    await start;
    agent.cancel();
    await running;
    // An installed model stays installed after Stop; only the session ends.
    expect(agent.debugState).toMatchObject({
      stage: "cancelled",
      availability: "available",
    });
    expect(activities(agent)).toEqual([]);
    expect(assistantText(agent)).toEqual([
      expect.stringMatching(/^Stopped\. Nothing from this run was published/),
    ]);
  });
});

describe("Express error recovery", () => {
  const draft = (line: string) =>
    block(
      `heading = Title("Checkout")\n${line}\nroot = Card([heading, total])`,
    );

  it("sends only the rejected line back and hot-swaps the correction", async () => {
    const model = new TestModel();
    const bad = 'total = Text("Total: " + "$53")';
    model.queue = [draft(bad), 'total = Text("Total: $53")'];
    const { agent } = await configured(model);
    await agent.enable();
    const publishedAt: number[] = [];
    await agent.runAgent(
      {},
      {
        onActivitySnapshotEvent: () =>
          void publishedAt.push(model.inputs.length),
      },
    );
    expect(model.inputs).toHaveLength(2);
    // A small correction prompt, not the conversation.
    const correction = JSON.parse(model.inputs[1]!).conversation;
    expect(correction).toHaveLength(1);
    const diagnostic = agent.debugState.compilerFeedback[0]!.match(
      /^Attempt 1, line 2: (.*) Corrected: /s,
    )![1]!;
    expect(correction[0].content).toBe(
      lineRepairTurn({ line: bad, diagnostic }),
    );
    expect(publishedAt).toEqual([2]);
    expect(agent.debugState).toMatchObject({
      stage: "ready",
      attempt: 1,
      dsl: draft('total = Text("Total: $53")'),
      compilerFeedback: [
        expect.stringMatching(/ Corrected: total = Text\("Total: \$53"\)$/),
      ],
    });
  });

  it("corrects a component the catalog refuses on the line that assigned it", async () => {
    const model = new TestModel();
    model.queue = [
      draft('total = Text("Total: $53", bogus=1)'),
      'total = Text("Total: $53", fontWeight="semibold")',
    ];
    const { agent } = await configured(model);
    await agent.enable();
    await agent.runAgent();
    expect(model.inputs).toHaveLength(2);
    expect(lastTurn(model.inputs[1]!)).toContain(
      'total = Text("Total: $53", bogus=1)',
    );
    expect(agent.debugState).toMatchObject({ stage: "ready", attempt: 1 });
  });

  it(`writes the whole block again after ${LINE_FIXES} corrections that do not compile`, async () => {
    const model = new TestModel();
    const bad = 'total = Spacer("Total: $53")';
    model.queue = [draft(bad), ...Array<string>(LINE_FIXES).fill(bad)];
    model.output = draft('total = Text("Total: $53")');
    const { agent } = await configured(model);
    await agent.enable();
    await agent.runAgent();
    expect(model.inputs).toHaveLength(LINE_FIXES + 2);
    const regeneration = model.inputs.at(-1)!;
    expect(request(regeneration)).toBe(request(model.inputs[0]!));
    expect(rejectedOf(regeneration)).toBe(draft(bad));
    expect(lastTurn(regeneration)).toBe(
      repairTurn(
        agent.debugState.compilerFeedback.at(-1)!.replace(/^Attempt 1: /, ""),
      ),
    );
    expect(agent.debugState).toMatchObject({ stage: "ready", attempt: 2 });
    expect(agent.debugState.compilerFeedback).toHaveLength(LINE_FIXES + 1);
  });

  it("writes the whole block again when no single line is to blame", async () => {
    const model = new TestModel();
    const dangling = block(
      'heading = Title("Checkout")\nroot = Card([heading, total])',
    );
    model.queue = [dangling];
    const { agent } = await configured(model);
    await agent.enable();
    const publishedAt: number[] = [];
    await agent.runAgent(
      {},
      {
        onActivitySnapshotEvent: () =>
          void publishedAt.push(model.inputs.length),
      },
    );
    expect(model.inputs).toHaveLength(2);
    expect(rejectedOf(model.inputs[1]!)).toBe(dangling);
    expect(lastTurn(model.inputs[1]!)).toContain("total");
    expect(publishedAt).toEqual([2]);
    expect(agent.debugState).toMatchObject({ stage: "ready", attempt: 2 });
  });

  it("keeps the previous UI after three rejected responses", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    await agent.runAgent();
    const before = activities(agent);
    agent.addMessage({ id: "card", role: "user", content: "A card" });
    model.output = block("root = Card([missing])");
    await agent.runAgent();
    expect(model.inputs).toHaveLength(4);
    expect(agent.debugState.stage).toBe("error");
    expect(agent.debugState.compilerFeedback).toHaveLength(3);
    expect(activities(agent)).toEqual(before);
    expect(assistantText(agent).at(-1)).toMatch(
      /^I could not produce a valid interface in 3 attempts, so nothing was published\./,
    );
  });
});

describe("conversation outcomes", () => {
  it("answers small talk in prose without publishing or counting a render", async () => {
    const model = new TestModel();
    model.output = "Hello! Describe a card or a form and I will build it.";
    const { agent } = await configured(model);
    await agent.enable();
    await agent.runAgent();
    expect(model.inputs).toHaveLength(1);
    expect(agent.debugState).toMatchObject({
      stage: "answered",
      operations: [],
      diagnostics: [],
    });
    expect(activities(agent)).toEqual([]);
    expect(assistantText(agent)).toEqual([model.output]);
  });

  it("does not take prose as the answer to an action or a rejected draft", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    await agent.runAgent();
    model.queue = ["Thanks, you are registered."];
    model.output = block(
      `surface("view-1", update=true)\ndone = Text("Registered")\nroot = Card([heading, price, form, done])`,
    );
    await agent.runAgent({
      forwardedProps: uiEnvelope("view-1", registerAction({})),
    });
    expect(agent.debugState.compilerFeedback).toEqual([
      "Attempt 1: The reply has no <a2ui> block.",
    ]);
    expect(agent.debugState).toMatchObject({ stage: "ready", attempt: 2 });

    model.queue = [
      block("root = Card([missing])"),
      "Sorry, I cannot build that.",
    ];
    agent.addMessage({ id: "card", role: "user", content: "A card" });
    await agent.runAgent();
    expect(agent.debugState.compilerFeedback[1]).toBe(
      "Attempt 2: The reply has no <a2ui> block.",
    );
    expect(agent.debugState).toMatchObject({ stage: "ready", attempt: 3 });
  });
});

describe("model download consent", () => {
  function engine(
    backend: "chrome" | "transformers",
    availability: Availability,
  ) {
    return {
      info: { backend, model: `${backend}-model`, device: "test" },
      availability: vi.fn(async () => availability),
      enable: vi.fn(async (_system: string) => {}),
      generate: vi.fn(async function* () {}),
      destroy: vi.fn(),
    } satisfies LocalModel;
  }

  it("asks again before downloading fallback weights when Chrome cannot start", async () => {
    const chrome = engine("chrome", "available");
    const fallback = engine("transformers", "downloadable");
    chrome.enable.mockRejectedValueOnce(new Error("NotAllowedError"));
    const agent = new ChromeExpressAgent(
      new BrowserModel(chrome, fallback, false),
    );
    await agent.configure(exportA2UICatalog(testUI), testManifest);
    const { systemPrompt } = new ExpressCompiler(exportA2UICatalog(testUI));
    await agent.enable();
    expect(chrome.enable.mock.calls[0]![0]).toBe(systemPrompt);
    expect(fallback.enable).not.toHaveBeenCalled();
    expect(agent.debugState).toMatchObject({
      availability: "downloadable",
      modelStarting: false,
      model: { backend: "transformers" },
    });
    expect(agent.debugState.diagnostics[0]).toContain(
      "No fallback weights were downloaded",
    );
    await agent.enable();
    // Both engines read the same SDK guide.
    expect(fallback.enable.mock.calls[0]![0]).toBe(systemPrompt);
    expect(agent.debugState).toMatchObject({
      availability: "enabled",
      systemPrompt,
    });
  });
});

/** A model whose chunks the test releases, so the page can be inspected
 * while generation is blocked. `null` ends one response. With `live` off it
 * answers like TestModel. */
class StreamModel extends TestModel {
  live = true;
  /** Keeps yielding after Stop, like an engine that has not noticed yet. */
  ignoreAbort = false;
  /** Chunks the agent has taken and finished handling. */
  handled = 0;
  /** Runs as a chunk sent with `later` is released. */
  onLater = () => {};
  #chunks: { chunk: string | null; later: boolean }[] = [];
  #wake = () => {};
  /** Releases chunks right away. */
  push(...chunks: (string | null)[]) {
    this.#queue(chunks, false);
  }
  /** Releases chunks after some time has passed. */
  pushLater(...chunks: (string | null)[]) {
    this.#queue(chunks, true);
  }
  #queue(chunks: (string | null)[], later: boolean) {
    this.#chunks.push(...chunks.map((chunk) => ({ chunk, later })));
    this.#wake();
  }
  override async *generate(input: string, prompt: string, signal: AbortSignal) {
    if (!this.live) return yield* super.generate(input, prompt, signal);
    this.inputs.push(input);
    while (true) {
      while (!this.#chunks.length) {
        if (!this.ignoreAbort) signal.throwIfAborted();
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
          if (!this.ignoreAbort)
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (!this.ignoreAbort) signal.throwIfAborted();
      const { chunk, later } = this.#chunks.shift()!;
      if (chunk === null) return;
      if (later) this.onLater();
      yield chunk;
      this.handled++;
    }
  }
}

/** The page as the Angular renderer runs it: every change of the agent's
 * messages is ingested into a real native manager, and the route discards
 * withdrawn previews. */
function mirror(agent: ChromeExpressAgent) {
  const page = new GenerativeUISurfaceManager(testUI);
  page.registerTarget(EXPRESS_TARGET, { components: EXPRESS_COMPONENTS });
  const read = (messages: readonly Message[]) => {
    for (const message of messages)
      if (
        message.role === "activity" &&
        message.activityType === "generative-ui-surface"
      )
        page.ingest(
          agent.threadId,
          agent.agentId,
          message.content as unknown as GenerativeUISurfaceContent,
        );
    discardWithdrawnPreviews(page, agent.threadId, messages);
  };
  agent.subscribe({ onMessagesChanged: ({ messages }) => read(messages) });
  read(agent.messages);
  return page;
}

describe("progressive rendering while the model streams", () => {
  let clock = 0;
  beforeEach(() => {
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  /** Releases each chunk once the preview interval has passed. */
  const send = (model: StreamModel, ...chunks: (string | null)[]) => {
    model.onLater = () => {
      clock += PREVIEW_INTERVAL_MS;
    };
    model.pushLater(...chunks);
  };
  const shown = (page: GenerativeUISurfaceManager, agent: ChromeExpressAgent) =>
    page.getSurfaceForTarget(EXPRESS_TARGET, agent.threadId);
  const props = (
    page: GenerativeUISurfaceManager,
    agent: ChromeExpressAgent,
    id: string,
  ) =>
    shown(page, agent)?.model.componentsModel.get(id)?.properties as
      | Record<string, unknown>
      | undefined;
  /** Lets the events emitted so far reach the page. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("shows a root-last view statement by statement before EOS, and commits the throttled end", async () => {
    const model = new StreamModel();
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    const run = agent.runAgent();
    send(model, '<a2ui>\n$/name = ""\nheading = Title("Checkout")\n');
    await vi.waitFor(() =>
      expect(props(page, agent, "heading")).toMatchObject({ text: "Checkout" }),
    );
    expect(shown(page, agent)).toMatchObject({
      surfaceId: "view-1",
      status: "streaming",
    });
    expect(agent.debugState.stage).toBe("generating");

    send(
      model,
      'name = TextField("Full name", $/name)\nsubmit = Button("Pay", submit=true)\n',
    );
    await vi.waitFor(() =>
      expect(props(page, agent, "name")).toMatchObject({ label: "Full name" }),
    );
    page.setOwnedValue(shown(page, agent)!.key, "/name", "Ada");

    // Inside the interval nothing is published; the end of the response
    // replaces the preview due at the interval's end.
    model.push(
      'form = Form([name, submit], Event("pay", {name: $/name}))\nroot = Card([heading, form])\n</a2ui>',
    );
    await vi.waitFor(() => expect(model.handled).toBe(3));
    await settle();
    expect(props(page, agent, "form")).toBeUndefined();
    model.push(null);
    await run;

    const view = shown(page, agent)!;
    expect(view).toMatchObject({ surfaceId: "view-1", status: "ready" });
    expect(props(page, agent, "form")).toBeDefined();
    expect(view.model.dataModel.get("/name")).toBe("Ada");
    // No preview that was due lands on the committed view later.
    await new Promise((resolve) =>
      setTimeout(resolve, PREVIEW_INTERVAL_MS * 2),
    );
    expect(shown(page, agent)).toMatchObject({ status: "ready" });
    // The committed activity holds the compiler's operations only.
    expect(activities(agent)).toHaveLength(1);
    expect(activities(agent)[0]!.content.operations).toEqual(
      agent.debugState.operations,
    );
    expect(agent.debugState.stage).toBe("ready");
  });

  it("streams an update into its view without touching the user's values", async () => {
    const model = new StreamModel();
    model.live = false;
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    await agent.runAgent();
    page.setOwnedValue(shown(page, agent)!.key, "/name", "Ada");
    model.live = true;
    const run = agent.runAgent({
      forwardedProps: uiEnvelope(
        "view-1",
        registerAction({ name: "Ada" }),
        page.describeSurfaces(agent.threadId)["view-1"]!.dataModel,
      ),
    });
    send(
      model,
      '<a2ui>\nsurface("view-1", update=true)\nheading = Title("Thanks, Ada")\n',
    );
    await vi.waitFor(() =>
      expect(props(page, agent, "heading")).toMatchObject({
        text: "Thanks, Ada",
      }),
    );
    expect(shown(page, agent)!.model.dataModel.get("/name")).toBe("Ada");
    send(
      model,
      'result = Card([Title("Paid")])\nroot = Card([heading, price, form, result])\n</a2ui>',
      null,
    );
    await run;
    expect(agent.debugState).toMatchObject({ stage: "ready", attempt: 1 });
    expect(activities(agent)).toHaveLength(1);
    expect(props(page, agent, "root")).toMatchObject({
      children: ["heading", "price", "form", "result"],
    });
    expect(shown(page, agent)!.model.dataModel.get("/name")).toBe("Ada");
  });

  it("withdraws a rejected new view, leaves no ghost, and reuses its id", async () => {
    const model = new StreamModel();
    model.live = false;
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    await agent.runAgent();
    const before = JSON.stringify(activities(agent));
    model.live = true;
    agent.addMessage({ id: "second", role: "user", content: "A draft card" });
    const run = agent.runAgent();
    send(model, '<a2ui>\ndraft = Title("Draft")\n');
    await vi.waitFor(() =>
      expect(shown(page, agent)?.surfaceId).toBe("view-2"),
    );
    expect(props(page, agent, "draft")).toMatchObject({ text: "Draft" });
    // The block never defines `missing`, on every attempt.
    send(model, "root = Card([draft, missing])\n</a2ui>", null);
    send(model, block("root = Card([missing])"), null);
    send(model, block("root = Card([missing])"), null);
    await run;
    expect(agent.debugState.stage).toBe("error");
    expect(JSON.stringify(activities(agent))).toBe(before);
    expect(page.describeSurfaces(agent.threadId)).toEqual({
      "view-1": { target: EXPRESS_TARGET },
    });
    expect(shown(page, agent)!.surfaceId).toBe("view-1");
    expect(assistantText(agent).at(-1)).toMatch(
      /^I could not produce a valid interface in 3 attempts, so its partial preview was withdrawn\./,
    );

    agent.addMessage({ id: "third", role: "user", content: "A card" });
    const retry = agent.runAgent();
    send(model, block('card = Title("Kept")\nroot = Card([card])'), null);
    await retry;
    expect(Object.keys(page.describeSurfaces(agent.threadId))).toEqual([
      "view-1",
      "view-2",
    ]);
    expect(activities(agent)).toHaveLength(2);
  });

  it("restores the committed view and its values on Stop", async () => {
    const model = new StreamModel();
    model.live = false;
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    await agent.runAgent();
    page.setOwnedValue(shown(page, agent)!.key, "/name", "Ada");
    const before = JSON.stringify(activities(agent));
    model.live = true;
    agent.addMessage({ id: "edit", role: "user", content: "Rename it" });
    const run = agent.runAgent({
      forwardedProps: uiEnvelope(
        "view-1",
        undefined,
        page.describeSurfaces(agent.threadId)["view-1"]!.dataModel,
      ),
    });
    send(
      model,
      '<a2ui>\nsurface("view-1", update=true)\nheading = Title("Renamed")\n',
    );
    await vi.waitFor(() =>
      expect(props(page, agent, "heading")).toMatchObject({ text: "Renamed" }),
    );
    agent.cancel();
    await run;
    expect(agent.debugState.stage).toBe("cancelled");
    expect(JSON.stringify(activities(agent))).toBe(before);
    expect(props(page, agent, "heading")).toMatchObject({
      text: "Register for Design Day",
    });
    expect(shown(page, agent)!.model.dataModel.get("/name")).toBe("Ada");
    expect(assistantText(agent).at(-1)).toMatch(
      /^Stopped\. The partial preview from this run was withdrawn/,
    );
  });

  it("restores the transcript when the subscriber detaches before the rollback", async () => {
    const model = new StreamModel();
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    const run = agent.runAgent().catch(() => undefined);
    send(model, '<a2ui>\nheading = Title("Checkout")\n');
    await vi.waitFor(() => expect(props(page, agent, "heading")).toBeDefined());
    await agent.detachActiveRun();
    await run;
    await vi.waitFor(() =>
      expect(agent.debugState).toMatchObject({
        stage: "cancelled",
        operations: [],
      }),
    );
    expect(activities(agent)).toEqual([]);
    expect(page.describeSurfaces(agent.threadId)).toEqual({});
  });

  it("ignores chunks of a run the page disposed", async () => {
    const model = new StreamModel();
    model.ignoreAbort = true;
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    const run = agent.runAgent();
    send(model, '<a2ui>\nheading = Title("Checkout")\n');
    await vi.waitFor(() => expect(props(page, agent, "heading")).toBeDefined());
    const messages = agent.messages.length;
    agent.dispose();
    send(model, 'late = Text("Late")\n');
    await run;
    expect(model.handled).toBe(1);
    expect(props(page, agent, "late")).toBeUndefined();
    expect(agent.messages).toHaveLength(messages);
    expect(agent.debugState.stage).toBe("idle");
  });

  it("shows the latest lines by the end of the interval while the model is silent", async () => {
    const model = new StreamModel();
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    const run = agent.runAgent();
    // The only chunk arrives inside the interval, then the model blocks.
    model.push(
      '<a2ui>\n$/name = ""\nheading = Title("Checkout")\nname = TextField("Full name", $/name)\n',
    );
    await vi.waitFor(() => expect(model.handled).toBe(1));
    expect(props(page, agent, "heading")).toBeUndefined();
    await vi.waitFor(() =>
      expect(props(page, agent, "heading")).toMatchObject({ text: "Checkout" }),
    );
    expect(props(page, agent, "name")).toMatchObject({ label: "Full name" });
    expect(shown(page, agent)).toMatchObject({ status: "streaming" });
    expect(agent.debugState.stage).toBe("generating");

    // A line due at the next interval's end, then Stop: it never lands on
    // the withdrawn preview.
    model.push('notes = Text("Late")\n');
    await settle();
    expect(model.handled).toBe(2);
    agent.cancel();
    await run;
    await new Promise((resolve) =>
      setTimeout(resolve, PREVIEW_INTERVAL_MS * 2),
    );
    expect(agent.debugState.stage).toBe("cancelled");
    expect(activities(agent)).toEqual([]);
    expect(page.describeSurfaces(agent.threadId)).toEqual({});
  });

  it("leaves a newer run of the thread alone when an old run notices Stop late", async () => {
    let release: () => void = () => {};
    class LateModel extends StreamModel {
      #first = true;
      override async *generate(
        input: string,
        prompt: string,
        signal: AbortSignal,
      ) {
        if (!this.#first) return yield* super.generate(input, prompt, signal);
        this.#first = false;
        clock += PREVIEW_INTERVAL_MS;
        yield '<a2ui>\nheading = Title("Old")\n';
        // An engine that notices Stop only after the next run has begun.
        await new Promise<void>((resolve) => {
          release = () => resolve();
        });
        yield 'late = Text("Late")\n';
      }
    }
    const model = new LateModel();
    const destroy = vi.spyOn(model, "destroy");
    const { agent } = await configured(model);
    await agent.enable();
    const page = mirror(agent);
    const old = agent.runAgent().catch(() => undefined);
    await vi.waitFor(() =>
      expect(props(page, agent, "heading")).toMatchObject({ text: "Old" }),
    );
    await agent.detachActiveRun();
    await old;
    // Leaving takes the old preview back before the model notices.
    expect(activities(agent)).toEqual([]);
    expect(page.describeSurfaces(agent.threadId)).toEqual({});

    agent.addMessage({ id: "newer", role: "user", content: "A card" });
    const newer = agent.runAgent();
    send(model, '<a2ui>\nheading = Title("New")\n');
    await vi.waitFor(() =>
      expect(props(page, agent, "heading")).toMatchObject({ text: "New" }),
    );
    const transcript = JSON.stringify(agent.messages);
    release();
    await settle();
    // The old run withdraws nothing, releases no session and reports nothing.
    expect(JSON.stringify(agent.messages)).toBe(transcript);
    expect(props(page, agent, "heading")).toMatchObject({ text: "New" });
    expect(destroy).not.toHaveBeenCalled();
    expect(agent.debugState).toMatchObject({ stage: "generating" });
    expect(agent.debugState.operations).not.toEqual([]);

    send(model, "root = Card([heading])\n</a2ui>", null);
    await newer;
    expect(agent.debugState.stage).toBe("ready");
    expect(activities(agent)).toHaveLength(1);
    expect(props(page, agent, "heading")).toMatchObject({ text: "New" });
    expect(props(page, agent, "late")).toBeUndefined();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("detects a list the native manager would take for an extension", () => {
    const op = (text: string): A2UIOperation => ({
      version: "v1.0",
      updateComponents: {
        surfaceId: "view-1",
        components: [{ id: "root", component: "Text", text }],
      },
    });
    const data: A2UIOperation = {
      version: "v1.0",
      updateDataModel: { surfaceId: "view-1", path: "/a", value: 1 },
    };
    // The manager compares only the operation it applied last.
    expect(hidesChange([op("a"), data], [op("b"), data])).toBe(true);
    expect(hidesChange([op("a"), data], [op("a"), data, op("b")])).toBe(false);
    expect(hidesChange([data, op("a")], [data, op("b")])).toBe(false);
    expect(hidesChange([data, op("a")], [op("b")])).toBe(false);
  });
});
