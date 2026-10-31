import { describe, expect, it } from "vitest";
import { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
import { ChromeExpressAgent } from "./chrome-express-agent";
import { ChromeModel } from "./chrome-model";
import { EXPRESS_EXAMPLES } from "./express-compiler";
import { testManifest, testUI } from "./test-catalog";

class TestModel extends ChromeModel {
  output = `<a2ui>\n${EXPRESS_EXAMPLES.form}\n</a2ui>`;
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
    yield this.output;
  }
  override destroy() {}
}

async function configured(model = new TestModel()) {
  const agent = new ChromeExpressAgent(model);
  await agent.configure(exportA2UICatalog(testUI), testManifest, testUI);
  agent.setState({ ...agent.state, unrelated: "preserved" });
  agent.addMessage({
    id: "request",
    role: "user",
    content: "Create a trip form",
  });
  return { agent, model };
}

describe("browser-local CopilotKit agent", () => {
  it("returns native prop-type rejections to the model before publishing UI", async () => {
    class PropRepairModel extends TestModel {
      override async *generate(input: string) {
        this.inputs.push(input);
        yield this.inputs.length === 1
          ? 'root = Text("Total", weight="semibold")'
          : 'root = Text("Total", fontWeight="semibold")';
      }
    }
    const { agent, model } = await configured(new PropRepairModel());
    await agent.enable();
    await agent.runAgent();
    expect(model.inputs).toHaveLength(2);
    expect(model.inputs[1]).toContain("weight");
    expect(model.inputs[1]).toContain("Expected number");
    expect(agent.debugState.stage).toBe("ready");
    expect(agent.debugState.attempt).toBe(2);
    expect(
      agent.messages.filter((message) => message.role === "activity"),
    ).toHaveLength(1);
  });
  it("requires model enablement and has no preset execution path", async () => {
    const { agent, model } = await configured();
    await agent.runAgent();
    expect(agent.debugState.stage).toBe("error");
    expect(agent.messages.some((message) => message.role === "activity")).toBe(
      false,
    );
    expect(model.inputs).toEqual([]);
    expect(agent).not.toHaveProperty("useManualSource");
  });

  it("teaches Express and emits model state plus validated surface activities", async () => {
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
    expect(events).toEqual(
      expect.arrayContaining([
        "STATE_SNAPSHOT",
        "STATE_DELTA",
        "ACTIVITY_SNAPSHOT",
      ]),
    );
    expect(agent.state.unrelated).toBe("preserved");
    expect(agent.debugState).toMatchObject({
      stage: "ready",
      source: "model",
      model: model.info,
    });
    expect(agent.debugState.operations.length).toBeGreaterThan(0);
    expect(model.enabledPrompt).toContain("A2UI Express DSL Output Contract");
    expect(model.enabledPrompt).not.toContain("render_ui");
    expect(JSON.parse(model.inputs[0]!).conversation[0].content).toBe(
      "Create a trip form",
    );
    expect(model.inputs[0]).not.toContain("unrelated");
  });

  it("returns compiler feedback and publishes only the repaired model response", async () => {
    class RepairModel extends TestModel {
      override async *generate(input: string) {
        this.inputs.push(input);
        yield this.inputs.length === 1
          ? 'root = Badge("Local", color="green")'
          : this.output;
      }
    }
    const { agent, model } = await configured(new RepairModel());
    await agent.enable();
    const publishedAt: number[] = [];
    await agent.runAgent(
      {},
      {
        onActivitySnapshotEvent: () => {
          publishedAt.push(model.inputs.length);
        },
      },
    );
    expect(model.inputs).toHaveLength(2);
    expect(JSON.parse(model.inputs[1]!).conversation.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("color"),
    });
    expect(publishedAt).toEqual([2]);
    expect(agent.debugState).toMatchObject({
      stage: "ready",
      attempt: 2,
      diagnostics: [],
    });
  });

  it("keeps the previous model-generated UI after three invalid responses", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    await agent.runAgent();
    const before = agent.messages.filter(
      (message) => message.role === "activity",
    );
    model.output = 'root = Unknown("invalid")';
    await agent.runAgent();
    expect(model.inputs).toHaveLength(4);
    expect(agent.debugState.stage).toBe("error");
    expect(agent.debugState.compilerFeedback).toHaveLength(3);
    expect(
      agent.messages.filter((message) => message.role === "activity"),
    ).toEqual(before);
  });

  it("passes action data to inference and retains one cumulative surface activity", async () => {
    const { agent, model } = await configured();
    await agent.enable();
    await agent.runAgent();
    const surfaceId = agent.debugState.surfaceId;
    model.output = `surface(${JSON.stringify(surfaceId)}, update=true)\n$/status = "Updated"`;
    const action = {
      version: "v1.0",
      action: {
        name: "plan_trip",
        surfaceId,
        sourceComponentId: "submit",
        timestamp: "2026-10-31T12:00:00.000Z",
        context: { name: "Alex" },
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
    expect(model.inputs).toHaveLength(2);
    expect(JSON.parse(model.inputs[1]!).action).toEqual(action);
    expect(JSON.parse(model.inputs[1]!).instruction).toContain(
      "Preserve all existing input values",
    );
    expect(agent.debugState.stage).toBe("ready");
    const activities = agent.messages.filter(
      (message) => message.role === "activity",
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]!.content.operations).toHaveLength(2);
    expect(agent.debugState.operations[0]).toMatchObject({
      updateDataModel: { surfaceId, path: "/status", value: "Updated" },
    });
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
    expect(agent.debugState).toMatchObject({
      stage: "cancelled",
      availability: "downloadable",
    });
    expect(agent.messages.some((message) => message.role === "activity")).toBe(
      false,
    );
  });
});
