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
  discardWithdrawnPreviews,
  initialDebugState,
} from "../chrome-express-agent";
import type { ExpressDebugState } from "../chrome-express-agent";
import { CHECKOUT_GUIDANCE } from "../checkout-guidance";
import { EXPRESS_COMPONENTS } from "../express-compiler";
import {
  LOCAL_MODEL_ROOT,
  CONFIGURED_HUB_MODELS,
  E2B_EXPORT_ID,
  TARGET_EXPORT_ID,
  exportBase,
  hubExportId,
  localExportId,
} from "../local-export";
import { DEMO_PROMPTS } from "../demo-prompts";
import { BROWSER_MODEL_MODES } from "../browser-model";
import type { BrowserModelMode } from "../browser-model";
import { EXPRESS_DEPLOYMENT } from "../deployment";
import { CodeSourceComponent } from "../code-source.component";

type ExpandedPanel = "conversation" | "source" | "preview" | "debug";
type DebugTab = "operations" | "prompt" | "state" | "data";

@Component({
  selector: "a2ui-express-demo",
  imports: [CopilotChat, CopilotGenerativeUISurface, CodeSourceComponent],
  host: { "(document:keydown.escape)": "restorePanels($event)" },
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: "Describe an interface…",
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./a2ui-1.0-demo.component.html",
  styleUrl: "./a2ui-1.0-demo.component.css",
})
export class A2ui10DemoComponent {
  readonly examples = DEMO_PROMPTS;
  readonly modelMode = signal<BrowserModelMode>("base");
  /** The export the fine-tuned mode loads: the selected one, or the URL's. */
  readonly finetune = exportBase(localExportId() ?? TARGET_EXPORT_ID);
  /** The smaller fine-tune offered beside it. */
  readonly finetuneE2b = exportBase(E2B_EXPORT_ID);
  readonly selectedFinetune = computed(() =>
    this.modelMode() === "finetuned-e2b" ? this.finetuneE2b : this.finetune,
  );
  readonly copilotkit = inject(CopilotKit);
  readonly agentId = EXPRESS_AGENT_ID;
  readonly components = EXPRESS_COMPONENTS;
  readonly store = injectAgentStore(EXPRESS_AGENT_ID);
  readonly debug = computed(
    () =>
      (this.store()?.state() as { a2uiExpress?: ExpressDebugState } | undefined)
        ?.a2uiExpress ?? initialDebugState(),
  );
  readonly running = computed(() => this.store()?.isRunning() ?? false);
  readonly tab = signal<DebugTab>("operations");
  readonly debugCollapsed = signal(true);
  readonly debugBodyVisible = computed(
    () => !this.debugCollapsed() || this.expandedPanel() === "debug",
  );
  readonly expandedPanel = signal<ExpandedPanel | null>(null);
  private expansionTrigger?: HTMLButtonElement;
  readonly modelLabel = computed(
    () =>
      ({
        finetuned: `Gemma 4 ${this.finetune.size} · fine-tuned`,
        "finetuned-e2b": `Gemma 4 ${this.finetuneE2b.size} · fine-tuned`,
        base: "Gemma 4 E4B",
        chrome: "Chrome Prompt API",
      })[this.modelMode()],
  );
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
  /** Weights are a large download; say so before the user enables them. */
  readonly downloadNotice = computed(() => {
    const { availability, model } = this.debug();
    if (availability === "enabled" || availability === "unsupported") return "";
    const published = hubExportId(model?.model);
    if (published)
      return `First load: ~${exportBase(published).gigabytes} GB from Hugging Face · WebGPU required · cached in your browser.`;
    if (model?.model.startsWith("local/gemma-4-"))
      return EXPRESS_DEPLOYMENT.standalone
        ? `First load: ~${this.selectedFinetune().gigabytes} GB from this site · WebGPU required · cached in your browser.`
        : "Weights load from the local model server · WebGPU required · inference stays in your browser.";
    if (model?.backend === "transformers")
      return "First load: ~4.9 GB from Hugging Face · WebGPU required · cached in your browser.";
    if (model?.backend === "chrome" && availability === "downloadable")
      return "Chrome manages the built-in model’s download and storage.";
    return "";
  });
  readonly enableLabel = computed(() => {
    const { availability } = this.debug();
    if (availability === "enabled") return "Model enabled";
    return availability === "downloadable"
      ? "Download & enable"
      : "Enable local model";
  });
  readonly modelDetailsUrl = computed(() => {
    const model = this.debug().model;
    const published = hubExportId(model?.model);
    if (published) {
      const { repoId, revision } = CONFIGURED_HUB_MODELS[published];
      return `https://huggingface.co/${repoId}/tree/${revision}`;
    }
    return model?.model.startsWith("local/gemma-4-")
      ? `${LOCAL_MODEL_ROOT}${model.model}/a2ui-export-manifest.json`
      : model?.backend === "transformers"
        ? `https://huggingface.co/${model.model}`
        : "https://developer.chrome.com/docs/ai/prompt-api";
  });
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
  readonly debugJson = computed(
    () =>
      JSON.stringify(
        this.tab() === "operations"
          ? this.debug().operations
          : this.tab() === "data"
            ? this.formData()
            : this.debug(),
        null,
        2,
      ) ?? "",
  );
  readonly debugCodeLabel = computed(
    () =>
      ({
        operations: "Compiled JSON",
        state: "Agent state JSON",
        data: "Form data JSON",
        prompt: "System prompt",
      })[this.tab()],
  );

  constructor() {
    effect(() => {
      if (this.debug().stage === "error" && this.debug().diagnostics.length)
        this.debugCollapsed.set(false);
    });
    afterNextRender(() => {
      void this.prepare();
    });
    inject(DestroyRef).onDestroy(() => this.agent()?.dispose());
    // A preview the agent withdraws leaves no surface behind on the page.
    effect((onCleanup) => {
      const agent = this.agent();
      if (!agent) return;
      const { unsubscribe } = agent.subscribe({
        onMessagesChanged: ({ messages }) =>
          discardWithdrawnPreviews(
            this.runtime.manager,
            agent.threadId,
            messages,
          ),
      });
      onCleanup(unsubscribe);
    });
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
        // Application knowledge for checkout follow-ups. The agent adds it to
        // the run context only when a matching action is answered.
        [CHECKOUT_GUIDANCE],
      );
  }

  enable() {
    void this.agent()?.enable();
  }
  stop() {
    this.agent()?.cancel();
  }

  togglePanel(panel: ExpandedPanel, event: Event) {
    if (this.expandedPanel() === panel) {
      this.restorePanels();
      return;
    }
    this.expansionTrigger = event.currentTarget as HTMLButtonElement;
    this.expandedPanel.set(panel);
  }

  restorePanels(event?: Event) {
    if (!this.expandedPanel() || event?.defaultPrevented) return;
    this.expandedPanel.set(null);
    this.expansionTrigger?.focus();
  }

  selectDebugTab(tab: DebugTab) {
    this.tab.set(tab);
    this.debugCollapsed.set(false);
  }

  toggleDebugger() {
    if (this.expandedPanel() === "debug") {
      this.restorePanels();
      this.debugCollapsed.set(true);
    } else {
      this.debugCollapsed.update((value) => !value);
    }
  }

  async selectModel(event: Event) {
    const mode = (event.target as HTMLSelectElement).value;
    if (
      this.running() ||
      this.debug().modelStarting ||
      !(BROWSER_MODEL_MODES as readonly string[]).includes(mode)
    )
      return;
    this.modelMode.set(mode as BrowserModelMode);
    this.agent()?.selectModel(mode as BrowserModelMode);
    await this.reset();
  }

  async reset() {
    const agent = this.agent();
    if (!agent || this.running()) return;
    agent.dispose();
    agent.setMessages([]);
    agent.threadId = crypto.randomUUID();
    this.runtime.manager.setActiveThread(agent.threadId);
    agent.setState({ a2uiExpress: initialDebugState() });
    this.expandedPanel.set(null);
    this.debugCollapsed.set(true);
    await this.prepare();
  }

  async runExample(request: string) {
    if (
      this.running() ||
      this.debug().modelStarting ||
      this.debug().availability !== "enabled"
    )
      return;
    const agent = this.agent();
    if (!agent) return;
    if (agent.messages.length) {
      await this.reset();
      await agent.enable();
      if (this.debug().availability !== "enabled") return;
    }
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: request,
    });
    await this.copilotkit.core.runAgent({ agent });
  }
}
