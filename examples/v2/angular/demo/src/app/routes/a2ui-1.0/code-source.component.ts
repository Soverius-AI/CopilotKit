import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from "@angular/core";
import { highlightExpress, highlightJson } from "./express-highlight";

@Component({
  selector: "a2ui-code-source",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <pre
      tabindex="0"
      role="region"
      [attr.aria-label]="label()"
      [class.wrap]="wrap()"
    ><code
      class="hljs" [class.language-a2ui-express]="language() === 'express'" [class.language-json]="language() === 'json'"
      [innerHTML]="highlighted()"
    ></code>@if (!source()) {<span class="placeholder">{{ placeholder() }}</span>}</pre>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      min-width: 0;
      background: #0c192b;
    }
    pre {
      box-sizing: border-box;
      flex: 1;
      min-width: 0;
      margin: 0;
      padding: 18px;
      overflow: auto;
      white-space: pre;
      tab-size: 2;
      color: #e3edff;
      scrollbar-color: #3f5b80 #0c192b;
      font:
        13px/1.75 ui-monospace,
        SFMono-Regular,
        Consolas,
        monospace;
    }
    pre.wrap {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    pre:focus-visible {
      outline: 2px solid #7eb4f0;
      outline-offset: -3px;
    }
    code {
      font: inherit;
    }
    .placeholder {
      color: #8193aa;
    }
    /* Angular also shares chat's global theme with shadow roots after messages mount. */
    :host .hljs {
      color: #e3edff;
      background: transparent;
    }
    :host .hljs .hljs-meta {
      color: #ff8bb6;
    }
    :host .hljs .hljs-string {
      color: #b4f782;
    }
    :host .hljs .hljs-variable {
      color: #ffd36d;
    }
    :host .hljs .hljs-keyword {
      color: #ff96df;
      font-weight: 600;
    }
    :host .hljs .hljs-built_in {
      color: #a7b9ff;
    }
    :host .hljs .hljs-title {
      color: #5fd8ff;
      font-weight: 550;
    }
    :host .hljs .hljs-attr {
      color: #78e5eb;
    }
    :host .hljs .hljs-number,
    :host .hljs .hljs-literal {
      color: #d7adff;
    }
    :host .hljs .hljs-punctuation {
      color: #9baeca;
    }
  `,
})
export class CodeSourceComponent {
  readonly source = input("");
  readonly language = input<"express" | "json">("express");
  readonly label = input("Generated A2UI Express source");
  readonly placeholder = input("The model’s Express source will appear here.");
  readonly wrap = input(false);
  readonly highlighted = computed(() =>
    this.language() === "json"
      ? highlightJson(this.source())
      : highlightExpress(this.source()),
  );
}
