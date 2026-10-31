import { describe, expect, it } from "vitest";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import { ChromeExpressAgent } from "./chrome-express-agent";
import { ChromeModel } from "./chrome-model";
import { EXPRESS_PRESETS } from "./express-compiler";
import { testManifest, testUI } from "./test-catalog";

class TestModel extends ChromeModel {
  output = `<a2ui>\n${EXPRESS_PRESETS.form}\n</a2ui>`;
  input = "";
  enabledPrompt = "";
  override async availability(): Promise<Availability> {
    return "available" as const;
  }
  override async enable(prompt: string) {
    this.enabledPrompt = prompt;
  }
  override async *generate(input: string, prompt: string, signal: AbortSignal) {
    this.input = input;
    expect(prompt).toBe(this.enabledPrompt);
    signal.throwIfAborted();
    yield this.output;
  }
  override destroy() {}
}

async function configured(model = new TestModel()) {
  const agent = new ChromeExpressAgent(model);
  await agent.configure(exportA2UICatalog(testUI), testManifest);
  agent.setState({ ...agent.state, unrelated: "preserved" });
  agent.addMessage({
    id: "request",
    role: "user",
    content: "Create a trip form",
  });
  return { agent, model };
}

describe("browser-local CopilotKit agent", () => {
  it.each([
    [
      "shopping",
      "demo_checkout",
      {
        customer: {
          firstName: "Alex",
          lastName: "Morgan",
          email: "alex@example.com",
        },
        address: {
          city: "Vienna",
          street: "12 Garden Street",
          postalCode: "1010",
        },
        items: { backpacks: 2, bottles: 2 },
        delivery: "express",
        gift: true,
        promo: "SAVE10",
      },
      "$217.40",
    ],
    [
      "project",
      "demo_project",
      {
        person: { name: "Alex Morgan", email: "alex@example.com" },
        project: {
          budget: 4500,
          startDate: "2027-01-15",
          contact: "call",
          notes: "A new shop",
        },
      },
      "$4,500.00",
    ],
  ] as const)(
    "acknowledges a manual %s form submission without invoking the model",
    async (preset, event, context, amount) => {
      const { agent, model } = await configured();
      agent.useManualSource(EXPRESS_PRESETS[preset]);
      await agent.runAgent();
      const surfaceId = agent.debugState.surfaceId;
      const action = {
        version: "v1.0",
        action: {
          name: event,
          surfaceId,
          sourceComponentId: preset === "shopping" ? "checkout" : "form",
          timestamp: "2026-10-31T12:00:00.000Z",
          context,
        },
      };
      await agent.runAgent({
        forwardedProps: {
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
                    [surfaceId]: { target: "express-preview" },
                  },
                  copilotkit_contextSent: false,
                  copilotkit_action: action,
                },
              },
            },
          },
        },
      });
      expect(model.input).toBe("");
      expect(agent.debugState.stage).toBe("ready");
      expect(agent.debugState.source).toBe("manual");
      expect(agent.debugState.action).toEqual(action);
      expect(agent.debugState.operations).toEqual([
        {
          version: "v1.0",
          updateDataModel: {
            surfaceId,
            path: "/status",
            value: expect.stringContaining(amount),
          },
        },
      ]);
      expect(
        agent.messages.filter((message) => message.role === "activity"),
      ).toHaveLength(1);
    },
  );

  it("can enable a session while Chrome already has a model download in progress", async () => {
    const model = new TestModel();
    model.availability = async () => "downloading";
    const { agent } = await configured(model);
    expect(agent.debugState.availability).toBe("downloading");
    expect(agent.debugState.modelStarting).toBe(false);
    await agent.enable();
    expect(agent.debugState.availability).toBe("enabled");
    expect(agent.debugState.modelStarting).toBe(false);
  });

  it("teaches Express in the system prompt and emits DSL state plus surface activities", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    const events: string[] = [];
    await agent.runAgent(
      {},
      {
        onStateSnapshotEvent: ({ event }) => {
          events.push(event.type);
        },
        onStateDeltaEvent: ({ event }) => {
          events.push(event.type);
        },
        onActivitySnapshotEvent: ({ event }) => {
          events.push(event.type);
        },
      },
    );
    expect(events).toContain("STATE_SNAPSHOT");
    expect(events).toContain("STATE_DELTA");
    expect(events).toContain("ACTIVITY_SNAPSHOT");
    expect(agent.state.unrelated).toBe("preserved");
    expect(agent.debugState.stage).toBe("ready");
    expect(agent.debugState.dsl).toContain('Event("plan_trip"');
    expect(agent.debugState.operations.length).toBeGreaterThan(0);
    expect(model.enabledPrompt).toContain("A2UI Express DSL Output Contract");
    expect(model.enabledPrompt).not.toContain("render_ui");
    expect(JSON.parse(model.input).conversation[0].content).toBe(
      "Create a trip form",
    );
    expect(model.input).not.toContain("unrelated");
  });

  it("compiles manual DSL without enabling or invoking the model", async () => {
    const { agent, model } = await configured();
    agent.useManualSource(EXPRESS_PRESETS.card);
    await agent.runAgent();
    expect(model.input).toBe("");
    expect(agent.debugState.source).toBe("manual");
    expect(agent.debugState.stage).toBe("ready");
  });

  it("reports invalid output in state and publishes no new surface", async () => {
    const { agent } = await configured();
    agent.useManualSource(EXPRESS_PRESETS.form);
    await agent.runAgent();
    const before = agent.messages.filter(
      (message) => message.role === "activity",
    ).length;
    agent.useManualSource('root = NotInTheCatalog("x")');
    await agent.runAgent();
    expect(agent.debugState.stage).toBe("error");
    expect(agent.debugState.diagnostics.length).toBe(1);
    expect(agent.debugState.lastSuccessfulDsl).toBe(EXPRESS_PRESETS.form);
    expect(
      agent.messages.filter((message) => message.role === "activity"),
    ).toHaveLength(before);
  });

  it("cancels a generation before it can commit a preview", async () => {
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
    expect(agent.debugState.stage).toBe("cancelled");
    expect(agent.messages.some((message) => message.role === "activity")).toBe(
      false,
    );
  });
  it("keeps one cumulative activity per surface when applying an update", async () => {
    const { agent } = await configured();
    agent.useManualSource(EXPRESS_PRESETS.form);
    await agent.runAgent();
    const surfaceId = agent.debugState.surfaceId;
    await agent.configure(exportA2UICatalog(testUI), {
      ...testManifest,
      surfaces: { [surfaceId]: { target: "express-preview" } },
    });
    agent.useManualSource(
      `surface(${JSON.stringify(surfaceId)}, update=true)\n$/status = "Updated"`,
    );
    await agent.runAgent();
    const activities = agent.messages.filter(
      (message) => message.role === "activity",
    );
    expect(activities).toHaveLength(1);
    const operations = activities[0]!.content.operations as Record<
      string,
      unknown
    >[];
    expect(operations[0]).toHaveProperty("createSurface");
    expect(operations.at(-1)).toEqual({
      version: "v1.0",
      updateDataModel: { surfaceId, path: "/status", value: "Updated" },
    });
  });
});
