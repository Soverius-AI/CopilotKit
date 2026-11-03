import { Component, computed, effect, inject, input } from "@angular/core";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import { themeStyleSheet } from "@copilotkit/shared/generative-ui";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import { CopilotGenerativeUIChildren } from "./children.directive";
import { isTemplateChildren } from "./children";
import type { GenerativeUIChildren } from "./children";
import { GENERATIVE_UI_RUNTIME } from "./runtime";
import { GenerativeUIStyles } from "./styles";

const NO_ANCESTORS: readonly string[] = [];

/**
 * Experimental. Renders one surface: its root component and everything
 * under it. The chat card and `<copilot-generative-ui-surface>` use it; a
 * custom chat card renders the surface it gets with it.
 *
 * The host is the surface root. `display: contents` keeps it out of the
 * layout, and the `--a2ui-*` variables of the theme still reach every
 * component. The `a2ui-surface` class scopes the standard stylesheet.
 */
@Component({
  selector: "copilot-generative-ui-surface-view",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <ng-container [copilotGenerativeUIChildren]="root()" />
  `,
  host: {
    class: "a2ui-surface",
    style: "display: contents",
    "[attr.data-generative-ui-root]": "surface().surfaceId",
    "[attr.data-a2ui-theme]": "sheet()?.id",
  },
})
export class CopilotGenerativeUISurfaceView {
  readonly surface = input.required<ManagedSurface>();
  /**
   * While the surface streams and has no root component yet, renders its
   * top-level components (the ones no other component lists as a child) in
   * the order they arrived, instead of nothing. For an agent that writes
   * the root last. Off by default.
   */
  readonly partialPreview = input(false);

  readonly #runtime = inject(GENERATIVE_UI_RUNTIME);
  readonly #styles = inject(GenerativeUIStyles);

  /** The theme as a stylesheet, so its `dark` values apply in dark mode only. */
  protected readonly sheet = computed(
    () => themeStyleSheet(this.#runtime.theme()),
    { equal: (a, b) => a?.id === b?.id },
  );

  /** The root id, or the top-level ids of a partial preview. */
  readonly #rootValue = computed<string | readonly string[]>(
    () => {
      const surface = this.surface();
      if (!this.partialPreview()) return GENERATIVE_UI_ROOT_ID;
      this.#runtime.version();
      const nodes = surface.model.componentsModel.componentsMap;
      if (surface.status !== "streaming" || nodes.has(GENERATIVE_UI_ROOT_ID))
        return GENERATIVE_UI_ROOT_ID;
      const listed = new Set<string>();
      for (const node of nodes.values()) {
        const slots = this.#runtime.ui.components.get(node.type)?.slots ?? {};
        for (const slot of Object.keys(slots)) {
          const value = (node.properties as Record<string, unknown>)[slot];
          for (const id of [value].flat())
            if (typeof id === "string") listed.add(id);
            else if (isTemplateChildren(id)) listed.add(id.componentId);
        }
      }
      return [...nodes.keys()].filter((id) => !listed.has(id));
    },
    {
      equal: (a, b) =>
        a === b ||
        (Array.isArray(a) &&
          Array.isArray(b) &&
          a.length === b.length &&
          a.every((id, index) => id === b[index])),
    },
  );

  protected readonly root = computed<GenerativeUIChildren>(() => ({
    surface: this.surface(),
    basePath: undefined,
    ancestors: NO_ANCESTORS,
    value: this.#rootValue(),
  }));

  constructor() {
    effect((onCleanup) => {
      const sheet = this.sheet();
      if (sheet) {
        onCleanup(this.#styles.acquire(`a2ui-theme-${sheet.id}`, sheet.css));
      }
    });
  }
}
