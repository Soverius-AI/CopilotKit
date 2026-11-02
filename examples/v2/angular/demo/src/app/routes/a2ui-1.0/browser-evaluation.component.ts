import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from "@angular/core";
import {
  CopilotGenerativeUI,
  CopilotGenerativeUISurface,
  GENERATIVE_UI_RUNTIME,
  exportA2UICatalog,
} from "@copilotkit/angular/generative-ui";
import type { GenerativeUIRuntime } from "@copilotkit/angular/generative-ui";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import { ExpressCompiler, EXPRESS_COMPONENTS } from "./express-compiler";
import { creationTurn } from "./model-request";
import { localExportId } from "./local-export";
import { TransformersModel } from "./transformers-model";

interface EvaluationRuntime extends GenerativeUIRuntime {
  events: GenerativeUIUserEvent[];
  errors: string[];
}
interface Field {
  key: string;
  label: string;
  kind: string;
  initial: string | number | boolean;
  value: string;
  options: string[];
}
interface Case {
  case_id: string;
  request: string;
  model_request: string;
  system_prompt: string;
  spec: {
    required_text: string[];
    required_fields: Field[];
    submit_label: string;
  };
}
const SERVER = "http://127.0.0.1:8899";
const normalized = (value: unknown) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
const frame = () =>
  new Promise<void>((resolve) => {
    // Chrome can pause animation frames in a background tab during a long run.
    let first = 0,
      second = 0;
    const done = () => {
      clearTimeout(timer);
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      resolve();
    };
    const timer = setTimeout(done, 250);
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(done);
    });
  });
const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });

@Component({
  selector: "a2ui-browser-evaluation",
  host: { style: "display:block;height:100dvh;overflow:auto" },
  imports: [CopilotGenerativeUISurface],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: GENERATIVE_UI_RUNTIME,
      useFactory: (): EvaluationRuntime => {
        const parent = inject(CopilotGenerativeUI);
        const version = signal(0),
          errors: string[] = [],
          events: GenerativeUIUserEvent[] = [];
        const manager = new GenerativeUISurfaceManager(parent.ui, {
          onOperationRejected: ({ reason }) => errors.push(reason),
        });
        const unsubscribe = manager.subscribe(() =>
          version.update((value) => value + 1),
        );
        inject(DestroyRef).onDestroy(unsubscribe);
        return {
          ui: parent.ui,
          manager,
          dispatcher: parent.dispatcher,
          transport: "markdown",
          theme: parent.theme,
          version: version.asReadonly(),
          errors,
          events,
          reportError: ({ error }) => {
            errors.push(String(error));
          },
          // Capture the native event after the actual renderer resolves bindings.
          // Evaluation never sends a purchase or a message to another person.
          forwardEvent: async (event) => {
            events.push(event);
            return { ok: true, result: undefined };
          },
        };
      },
    },
  ],
  template: `
    <main
      style="
        max-width: 1200px;
        margin: 32px auto;
        padding: 24px;
        font-family: system-ui;
      "
    >
      <a href="/a2ui-1.0">Back to demo</a>
      <h1>Gemma browser evaluation</h1>
      <p>
        One attempt per case. The exported model runs in Chrome WebGPU with the
        standard Express prompt.
      </p>
      <p role="status">{{ status() }}</p>
      <p>{{ completed() }} completed · {{ passed() }} native checks passed</p>
      <button (click)="checkControls()" [disabled]="running()">
        Check evaluation controls
      </button>
      <button (click)="start()" [disabled]="running()">
        Start when the trained export is ready
      </button>
      <button (click)="stop()" [disabled]="!running()">Stop</button>
      <p>
        Cases unlock after the selected model is frozen. This page tests generated
        widgets, initial values, editing and form submission.
      </p>
      <h2>{{ activeCase() }}</h2>
      <copilot-generative-ui-surface
        id="express-preview"
        [components]="components"
        [autoScroll]="false"
        [partialPreview]="true"
      >
        <p>Waiting for generated UI.</p>
      </copilot-generative-ui-surface>
      <details>
        <summary>Generated Express</summary>
        <pre style="white-space: pre-wrap">{{ source() }}</pre>
      </details>
    </main>
  `,
})
export class BrowserEvaluationComponent {
  readonly components = EXPRESS_COMPONENTS;
  readonly status = signal("Ready to wait for training and export.");
  readonly completed = signal(0);
  readonly passed = signal(0);
  readonly activeCase = signal("");
  readonly source = signal("");
  readonly running = signal(false);
  readonly runtime = inject(GENERATIVE_UI_RUNTIME) as EvaluationRuntime;
  readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  #controller?: AbortController;
  #model?: TransformersModel;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }
  stop() {
    this.#controller?.abort();
    this.#model?.destroy();
  }

  private async checkNative(
    test: Case,
    source: string,
    compiler: ExpressCompiler,
    threadId: string,
  ) {
    const { operations } = compiler.parse(source, "view-1");
    this.runtime.manager.ingest(threadId, "browser-evaluation", {
      surfaceId: "view-1",
      target: "express-preview",
      catalogId: this.runtime.ui.id,
      operations,
      status: "ready",
      rejected: [],
    });
    await frame();
    const surface = this.runtime.manager.getSurface(threadId, "view-1");
    if (!surface) throw new Error("No native surface rendered.");
    const nodes = surface.model.componentsModel.componentsMap;
    const preview = this.element.nativeElement.querySelector<HTMLElement>(
      '[data-generative-ui-surface="express-preview"]',
    );
    if (!preview) throw new Error("Native preview is missing.");
    const display = normalized(preview.innerText);
    for (const fact of test.spec.required_text)
      if (!display.includes(normalized(fact)))
        throw new Error(`Native UI omitted: ${fact}`);
    const controls = Array.from(
      preview.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(
        "input[data-a2ui-input],select[data-a2ui-input],textarea[data-a2ui-input]",
      ),
    );
    if (controls.length !== test.spec.required_fields.length)
      throw new Error("Native input count differs from the request.");
    const bindings: Record<string, string> = {},
      edited: Record<string, unknown> = {},
      initialValues: Record<string, unknown> = {};
    for (const field of test.spec.required_fields) {
      const matches = controls.filter(
        (control) =>
          normalized(
            control.getAttribute("aria-label") ??
              Array.from(control.labels ?? [])
                .map((label) => label.textContent)
                .join(" "),
          ) === normalized(field.label),
      );
      if (matches.length !== 1)
        throw new Error(`Missing or repeated native field: ${field.label}`);
      const control = matches[0]!;
      const initial =
        control instanceof HTMLInputElement && control.type === "checkbox"
          ? control.checked
          : control.value;
      if (String(initial) !== String(field.initial))
        throw new Error(
          `Wrong native initial value: ${field.label}; expected ${JSON.stringify(field.initial)}, received ${JSON.stringify(initial)}`,
        );
      initialValues[field.key] = initial;
      if (field.kind === "select") {
        if (!(control instanceof HTMLSelectElement))
          throw new Error(`Wrong native select: ${field.label}`);
        const options = Array.from(control.options)
          .filter((option) => option.value !== "")
          .map((option) => option.text);
        if (JSON.stringify(options) !== JSON.stringify(field.options))
          throw new Error(`Wrong native options: ${field.label}`);
      } else if (
        field.kind === "textarea"
          ? !(control instanceof HTMLTextAreaElement)
          : !(control instanceof HTMLInputElement) ||
            control.type !==
              (field.kind === "checkbox"
                ? "checkbox"
                : field.kind === "number"
                  ? "number"
                  : field.kind === "email"
                    ? "email"
                    : "text")
      )
        throw new Error(`Wrong native input type: ${field.label}`);
      const node = [...nodes.values()].find(
        (node) => normalized(node.properties.label) === normalized(field.label),
      );
      const binding = node?.properties.value as
        | { path?: string; "@path"?: string }
        | undefined;
      const path = binding?.path ?? binding?.["@path"];
      if (!path || Object.values(bindings).includes(path))
        throw new Error(`Missing/duplicate binding: ${field.label}`);
      bindings[field.key] = path;
    }
    // Check all defaults before editing. An owned-state update can remount
    // native controls, so acquire the current input again for every edit.
    for (const field of test.spec.required_fields) {
      const current = this.element.nativeElement.querySelector<HTMLElement>(
        '[data-generative-ui-surface="express-preview"]',
      );
      const candidates = Array.from(
        current?.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(
          "input[data-a2ui-input],select[data-a2ui-input],textarea[data-a2ui-input]",
        ) ?? [],
      );
      const control = candidates.find(
        (entry) =>
          normalized(
            entry.getAttribute("aria-label") ??
              Array.from(entry.labels ?? [])
                .map((label) => label.textContent)
                .join(" "),
          ) === normalized(field.label),
      );
      if (!control)
        throw new Error(
          `Native input disappeared during editing: ${field.label}`,
        );
      // Standard TextField emits the DOM string, including variant="number".
      // Its numeric initial value remains checked separately before editing.
      const value =
        field.kind === "checkbox" ? field.value === "true" : field.value;
      if (control instanceof HTMLInputElement && control.type === "checkbox")
        control.checked = Boolean(value);
      else control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      control.dispatchEvent(new Event("blur", { bubbles: true }));
      edited[field.key] = value;
      await frame();
    }
    await frame();
    for (const [key, path] of Object.entries(bindings))
      if (
        JSON.stringify(surface.model.dataModel.get(path)) !==
        JSON.stringify(edited[key])
      )
        throw new Error(`Native edit did not reach owned state: ${key}`);
    if (test.spec.required_fields.length) {
      const button = [
        ...preview.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
      ].find(
        (button) =>
          normalized(button.textContent) === normalized(test.spec.submit_label),
      );
      if (!button) throw new Error("Native submit button is missing.");
      button.click();
      await frame();
      if (this.runtime.events.length !== 1)
        throw new Error("Native submission did not emit exactly one event.");
      const values = Object.values(this.runtime.events[0]!.context);
      const eventData = JSON.stringify(this.runtime.events[0]!.context);
      for (const value of Object.values(edited))
        if (
          !values.some(
            (entry) => JSON.stringify(entry) === JSON.stringify(value),
          ) &&
          !eventData.includes(JSON.stringify(value))
        )
          throw new Error("Native submit event omitted an entered value.");
    }
    if (this.runtime.errors.length)
      throw new Error(this.runtime.errors.join("; "));
    return {
      accepted: true,
      visibleText: display,
      initialValues,
      bindings,
      edited,
      submitEvents: [...this.runtime.events],
    };
  }

  async checkControls() {
    if (this.running() || !localExportId()) return;
    this.running.set(true);
    try {
      const response = await fetch(`${SERVER}/experiment/control-fixture`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("The control-check fixture is unavailable.");
      const fixture = await response.json();
      this.activeCase.set(
        "Control self-check · Codex-generated fixture, not Gemma inference",
      );
      this.source.set(fixture.source);
      this.runtime.errors.length = 0;
      this.runtime.events.length = 0;
      const compiler = new ExpressCompiler(exportA2UICatalog(this.runtime.ui));
      const threadId = crypto.randomUUID();
      this.runtime.manager.setActiveThread(threadId);
      await this.checkNative(fixture, fixture.source, compiler, threadId);
      this.status.set(
        `Control self-check passed: ${fixture.spec.required_fields.length} native inputs, owned edits and one submit event. This is not a Gemma evaluation score.`,
      );
    } catch (error) {
      this.status.set(`Control self-check failed: ${error}`);
    } finally {
      this.running.set(false);
    }
  }

  async start() {
    if (this.running() || !localExportId()) return;
    const controller = new AbortController();
    this.#controller = controller;
    const signal = controller.signal,
      runId = crypto.randomUUID();
    this.running.set(true);
    this.completed.set(0);
    this.passed.set(0);
    try {
      let ready:
        | {
            model_id: string;
            adapter_sha256: string;
            blind_cases_sha256: string;
            case_count: number;
            evaluation_kind: string;
          }
        | undefined;
      const deadline = Date.now() + 36 * 3600_000;
      while (!ready) {
        signal.throwIfAborted();
        const response = await fetch(`${SERVER}/experiment/status`, {
          signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error("The local evaluation server is unavailable.");
        const state = await response.json();
        if (state.phase === "failed") throw new Error(state.error);
        if (state.ready) ready = state.ready;
        else {
          this.status.set(
            `Waiting: ${state.phase}. Accepted training examples: ${state.accepted?.train ?? 0}/${state.target?.train ?? 100}.`,
          );
          if (Date.now() > deadline)
            throw new Error("Training/export wait exceeded 36 hours.");
          await wait(30_000, signal);
        }
      }
      const compiler = new ExpressCompiler(exportA2UICatalog(this.runtime.ui));
      const system = compiler.systemPrompt;
      this.status.set(`Loading ${ready.model_id} in WebGPU…`);
      const model = new TransformersModel(undefined, ready.model_id);
      this.#model = model;
      await model.enable(system, signal, (progress) =>
        this.status.set(
          `Loading exported Gemma: ${Math.round(progress * 100)}%`,
        ),
      );
      if (
        model.info.device !== "webgpu" ||
        model.info.artifactSha256 !== ready.adapter_sha256
      )
        throw new Error("The browser did not load the frozen model artifact.");
      const response = await fetch(
        `${SERVER}/experiment/cases?model=${ready.model_id}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("The sealed evaluation cases are unavailable.");
      const cases: Case[] = await response.json();
      if (cases.length !== ready.case_count)
        throw new Error("Evaluation case count differs from the frozen plan.");
      let lastAccepted: { caseId: string; source: string } | undefined;
      for (const test of cases) {
        signal.throwIfAborted();
        this.activeCase.set(test.case_id);
        this.source.set("");
        this.status.set(
          `Generating ${this.completed() + 1}/${cases.length} · ${ready.model_id} · ${ready.evaluation_kind}`,
        );
        const threadId = crypto.randomUUID();
        this.runtime.manager.setActiveThread(threadId);
        const request = creationTurn({
          request: test.request,
          earlier: [],
          context: [],
          views: [],
          newSurfaceId: "view-1",
        });
        if (request !== test.model_request || system !== test.system_prompt)
          throw new Error(
            "Browser prompt differs from the sealed runtime prompt.",
          );
        const started = performance.now();
        let source = "",
          error = "",
          native: Record<string, unknown> = {};
        this.runtime.errors.length = 0;
        this.runtime.events.length = 0;
        const inference = new AbortController();
        const timeout = setTimeout(
          () =>
            inference.abort(
              new Error("Browser inference exceeded ten minutes."),
            ),
          600_000,
        );
        try {
          for await (const chunk of model.generate(
            request,
            system,
            AbortSignal.any([signal, inference.signal]),
          )) {
            source += chunk;
            this.source.set(source);
          }
        } catch (cause) {
          throw new Error(
            `Browser inference failed at ${test.case_id}; this run is incomplete: ${cause}`,
            { cause: cause },
          );
        } finally {
          clearTimeout(timeout);
        }
        try {
          native = await this.checkNative(test, source, compiler, threadId);
          this.passed.update((count) => count + 1);
          lastAccepted = { caseId: test.case_id, source };
        } catch (cause) {
          signal.throwIfAborted();
          error = cause instanceof Error ? cause.message : String(cause);
          native = {
            accepted: false,
            error,
            rendererErrors: [...this.runtime.errors],
          };
        }
        const result = {
          ...test,
          run_id: runId,
          source,
          native,
          backend: "browser_webgpu",
          browserVerified: true,
          model: model.info,
          first_attempt_only: true,
          automatic_repairs: 0,
          elapsed_ms: performance.now() - started,
          coverage:
            "creation, native controls, owned edits and native submit event; no model-generated action reply",
        };
        const saved = await fetch(`${SERVER}/evaluation/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
          signal,
        });
        if (!saved.ok)
          throw new Error("Could not preserve the browser evaluation result.");
        this.completed.update((count) => count + 1);
        this.runtime.manager.discardSurface(threadId, "view-1");
      }
      const finalized = await fetch(`${SERVER}/evaluation/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
        signal,
      });
      if (!finalized.ok)
        throw new Error("Could not finalize the browser evaluation report.");
      const scored: { count: number; passed: number } = await finalized.json();
      if (scored.count !== cases.length)
        throw new Error("The saved evaluation report is incomplete.");
      // Leave an actual captured model result visible after the run. Replaying
      // its original source is a preview, not another inference or a scored case.
      if (lastAccepted) {
        const threadId = crypto.randomUUID();
        this.runtime.manager.setActiveThread(threadId);
        this.runtime.manager.ingest(threadId, "browser-evaluation", {
          surfaceId: "view-1",
          target: "express-preview",
          catalogId: this.runtime.ui.id,
          operations: compiler.parse(lastAccepted.source, "view-1").operations,
          status: "ready",
          rejected: [],
        });
        this.activeCase.set(
          `${lastAccepted.caseId} · replay of captured Gemma output`,
        );
        this.source.set(lastAccepted.source);
      }
      this.status.set(
        `Completed all ${cases.length} browser cases. ${scored.passed}/${cases.length} passed the full checks; ${this.passed()}/${cases.length} passed native control checks. The saved report includes each failure. ${ready.evaluation_kind === "curated_demo" ? "Curated examples, not an independent quality benchmark." : ""}`,
      );
    } catch (error) {
      this.status.set(signal.aborted ? "Evaluation stopped." : String(error));
    } finally {
      this.#model?.destroy();
      this.running.set(false);
    }
  }
}
