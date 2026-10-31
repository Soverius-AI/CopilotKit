import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from "@angular/core";
import { JsonPipe } from "@angular/common";
import {
  CopilotChat,
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
import { EXPRESS_COMPONENTS } from "../express-compiler";

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
  readonly tab = signal<"operations" | "prompt" | "state" | "data">(
    "operations",
  );
  readonly expandedPreview = signal(false);
  readonly runtime = inject(CopilotGenerativeUI);
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
        this.runtime.ui,
      );
  }

  enable() {
    void this.agent()?.enable();
  }
  stop() {
    this.agent()?.cancel();
  }

  reset() {
    const agent = this.agent();
    if (!agent || this.running()) return;
    agent.dispose();
    agent.setMessages([]);
    agent.threadId = crypto.randomUUID();
    this.runtime.manager.setActiveThread(agent.threadId);
    agent.setState({ a2uiExpress: initialDebugState() });
    this.expandedPreview.set(false);
    void this.prepare();
  }
}
