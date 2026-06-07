import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import type { GenerateSandboxedUiArgs } from "../../open-generative-ui";

@Component({
  selector: "copilot-open-generative-ui-tool-renderer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleMessage(); as message) {
      <div
        data-testid="open-generative-ui-tool-placeholder"
        class="copilot-open-generative-ui-placeholder"
      >
        {{ message }}
      </div>
    }
  `,
  styles: [
    `
      .copilot-open-generative-ui-placeholder {
        padding: 8px 12px;
        color: #999;
        font-size: 14px;
      }
    `,
  ],
})
export class CopilotOpenGenerativeUIToolRenderer implements ToolRenderer<GenerateSandboxedUiArgs> {
  readonly toolCall =
    input.required<AngularToolCall<GenerateSandboxedUiArgs>>();

  private readonly rotationIndex = signal(0);
  private readonly destroyRef = inject(DestroyRef);
  private interval: ReturnType<typeof setInterval> | undefined;

  private readonly messageCount = computed(
    () => this.toolCall().args.placeholderMessages?.length ?? 0,
  );

  protected readonly visibleMessage = computed(() => {
    const call = this.toolCall();
    if (call.status === "complete") return undefined;

    const messages = call.args.placeholderMessages;
    if (!messages?.length) return undefined;

    const count = messages.length;
    const index = this.rotationIndex() % count;
    return messages[index] ?? messages[0];
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());

    effect((onCleanup) => {
      const count = this.messageCount();
      const isComplete = this.toolCall().status === "complete";

      untracked(() => {
        this.clearTimer();
        this.rotationIndex.set(count > 0 ? count - 1 : 0);
      });

      if (count === 0 || isComplete) return;

      this.interval = setInterval(() => {
        this.rotationIndex.update((index) => (index + 1) % count);
      }, 5000);

      onCleanup(() => this.clearTimer());
    });
  }

  private clearTimer(): void {
    if (this.interval === undefined) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }
}
