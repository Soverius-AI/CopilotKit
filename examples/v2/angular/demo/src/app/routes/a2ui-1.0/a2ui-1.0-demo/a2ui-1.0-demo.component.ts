import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { JsonPipe } from "@angular/common";
import {
  CopilotChat,
  CopilotKit,
  injectAgentStore,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import {
  CopilotGenerativeUI,
  CopilotGenerativeUISurface,
  exportA2UICatalog,
} from "@copilotkit/angular/generative-ui";
import { buildGenerativeUIManifest } from "@copilotkit/core/generative-ui";
import {
  ChromeExpressAgent,
  EXPRESS_AGENT_ID,
  initialDebugState,
} from "../chrome-express-agent";
import type { ExpressDebugState } from "../chrome-express-agent";
import { EXPRESS_COMPONENTS, EXPRESS_PRESETS } from "../express-compiler";

@Component({
  selector: "a2ui-express-demo",
  imports: [CopilotChat, CopilotGenerativeUISurface, JsonPipe],
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: "Describe a card, form, or small dashboard…",
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./a2ui-1.0-demo.component.html",
  styleUrl: "./a2ui-1.0-demo.component.css",
})
export class A2ui10DemoComponent {
  readonly agentId = EXPRESS_AGENT_ID;
  readonly components = EXPRESS_COMPONENTS;
  readonly store = injectAgentStore(EXPRESS_AGENT_ID);
  readonly debug = computed(
    () =>
      (this.store()?.state() as { a2uiExpress?: ExpressDebugState } | undefined)
        ?.a2uiExpress ?? initialDebugState(),
  );
  readonly running = computed(() => this.store()?.isRunning() ?? false);
  readonly draft = signal<string>(EXPRESS_PRESETS.shopping);
  readonly tab = signal<"operations" | "prompt" | "state" | "data">(
    "operations",
  );
  readonly expandedPreview = signal(false);
  readonly runtime = inject(CopilotGenerativeUI);
  readonly #copilot = inject(CopilotKit);
  readonly ready = computed(
    () => !!this.debug().systemPrompt && this.debug().stage !== "preparing",
  );
  readonly canEnable = computed(
    () =>
      this.ready() &&
      !this.debug().modelStarting &&
      !["unsupported", "unavailable", "checking", "enabled"].includes(
        this.debug().availability,
      ),
  );
  readonly activeSurfaceId = computed(() => {
    this.runtime.version();
    const surfaces = this.runtime.manager.describeSurfaces(
      this.store()?.agent.threadId ?? "",
    );
    return Object.entries(surfaces)
      .filter(
        ([, surface]) =>
          surface.target === "express-preview" && !surface.status,
      )
      .at(-1)?.[0];
  });
  readonly formData = computed(() => {
    this.runtime.version();
    return (
      this.runtime.manager
        .debugSurfaces()
        .find(
          (surface) =>
            surface.threadId === this.store()?.agent.threadId &&
            surface.surfaceId === this.activeSurfaceId(),
        )?.dataModel ?? {}
    );
  });

  constructor() {
    effect(() => {
      const dsl = this.debug().dsl;
      if (dsl) this.draft.set(dsl);
    });
    afterNextRender(() => {
      void this.prepare();
    });
    inject(DestroyRef).onDestroy(() => this.agent()?.dispose());
  }

  agent() {
    const agent = this.store()?.agent;
    return agent instanceof ChromeExpressAgent ? agent : undefined;
  }

  async prepare() {
    const agent = this.agent();
    if (agent)
      await agent.configure(
        exportA2UICatalog(this.runtime.ui),
        buildGenerativeUIManifest(this.runtime, agent.threadId),
      );
  }

  enable() {
    void this.agent()?.enable();
  }
  stop() {
    this.agent()?.cancel();
  }

  async compile(source = this.draft(), label = "Compile edited Express") {
    const agent = this.agent();
    if (!agent || this.running()) return;
    agent.useManualSource(source);
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: label });
    try {
      await this.#copilot.core.runAgent({ agent });
    } catch {
      /* The agent publishes its diagnostic in state. */
    }
  }

  preset(kind: keyof typeof EXPRESS_PRESETS) {
    this.expandedPreview.set(kind === "shopping" || kind === "project");
    this.tab.set(
      kind === "shopping" || kind === "project" ? "data" : "operations",
    );
    this.draft.set(EXPRESS_PRESETS[kind]);
    void this.compile(
      EXPRESS_PRESETS[kind],
      `Compile the ${kind} preset (no inference)`,
    );
  }

  update() {
    const id = this.activeSurfaceId();
    if (id)
      void this.compile(
        `surface(${JSON.stringify(id)}, update=true)\n$/status = "Updated by Express. Your input is preserved."`,
        "Apply an Express data-model update (no inference)",
      );
  }

  reset() {
    const agent = this.agent();
    if (!agent || this.running()) return;
    agent.dispose();
    agent.setMessages([]);
    agent.threadId = crypto.randomUUID();
    this.runtime.manager.setActiveThread(agent.threadId);
    agent.setState({ a2uiExpress: initialDebugState() });
    this.draft.set(EXPRESS_PRESETS.shopping);
    this.expandedPreview.set(false);
    void this.prepare();
  }
}
