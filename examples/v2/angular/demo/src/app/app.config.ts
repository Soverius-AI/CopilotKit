import type { ApplicationConfig } from "@angular/core";
import { importProvidersFrom } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import {
  provideCopilotKit,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import { provideMCPApps } from "@copilotkit/angular/mcp-apps";
import { provideGenerativeUI } from "@copilotkit/angular/generative-ui";
import { provideGenerativeUIChart } from "@copilotkit/angular/generative-ui/chart";
import { provideGenerativeUIIcons } from "@copilotkit/angular/generative-ui/icons";
import { provideGenerativeUIMap } from "@copilotkit/angular/generative-ui/map";
import { shopUI } from "./routes/generative-ui/shop-ui";
import { CatalogAgent } from "./routes/generative-ui/catalog-agent";
import {
  ChromeExpressAgent,
  EXPRESS_AGENT_ID,
} from "./routes/a2ui-1.0/chrome-express-agent";
import { WildcardToolRenderComponent } from "./components/wildcard-tool-render.component";
import { a2uiDemoSandboxFunctions } from "./routes/a2ui/a2ui-demo-sandbox-functions";
import { dashboardCatalog } from "./routes/a2ui-angular/dashboard-catalog";
import { routes } from "./app.routes";
import { z } from "zod";

const browserInferenceRoute = globalThis.location?.pathname === "/a2ui-1.0";

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(BrowserModule),
    provideRouter(routes),
    // MCP Apps stays an opt-in secondary entry point of the package; the demo
    // opts in once at the root because the activity renderer is resolved from
    // the root injector (a lazy-route provider would never be seen).
    provideMCPApps(),
    // Native generative UI with the standard catalog (route /generative-ui).
    provideGenerativeUI({ ui: shopUI }),
    provideGenerativeUIChart(),
    provideGenerativeUIIcons(),
    provideGenerativeUIMap(),
    provideCopilotKit({
      // This route's self-managed agent needs no server. Reload when leaving
      // its standalone browser session to restore the other demos' runtime.
      runtimeUrl: browserInferenceRoute
        ? undefined
        : "http://localhost:3001/api/copilotkit",
      licenseKey: "ck_pub_00000000000000000000000000000000",
      // The standard components page (/generative-ui/catalog) runs a scripted
      // agent in the browser.
      agents: {
        "generative-ui-catalog": new CatalogAgent(shopUI.id),
        [EXPRESS_AGENT_ID]: new ChromeExpressAgent(),
      },
      renderToolCalls: [
        {
          name: "*",
          args: z.record(z.string(), z.unknown()),
          component: WildcardToolRenderComponent,
        },
      ],
      suggestionsConfig: [
        {
          consumerAgentId: EXPRESS_AGENT_ID,
          available: "always",
          suggestions: [
            {
              title: "Shopping inputs",
              message:
                "Create a simple Leaf & Light checkout card with Total $53. Include eight bound controls: Name, Email, Street, City, Country dropdown with Austria and Germany, Delivery dropdown with Standard and Express, Gift wrapping checkbox, and Delivery notes. Initialize all eight paths. Add a Review order Button with a review_order Event containing all eight paths. Put controls in a flat children list. Use no Form, no nested arrays, no Spacer, and no weight, wrap, or alignment arguments. Style only the Title dark green. Use the exact declared component signatures.",
            },
            {
              title: "Welcome card",
              message:
                "Create the Leaf & Light welcome card. Use one flat array for the Card children: never put an array inside that array. Use only a Card, a Title, three Text components, and a Badge. Include New arrivals, a sentence about indoor plants, Free shipping over $50, and Vienna pickup available. Use a calm green accent and keep it compact.",
            },
            {
              title: "Edit this view",
              message:
                "Update the title of the current interface to Ready for adventure. Preserve my input.",
            },
          ],
        },
        {
          consumerAgentId: "a2ui-recovery",
          available: "always",
          suggestions: [
            {
              title: "Recover after a retry",
              message: "Show the weekly signups dashboard",
            },
            {
              title: "Fail every attempt",
              message: "Show a dashboard that fails every attempt",
            },
          ],
        },
        {
          instructions:
            "Suggest follow-up tasks based on the current page content",
          available: browserInferenceRoute ? "disabled" : "always",
        },
      ],
      humanInTheLoop: [],
      // The legacy demos register their own JSON schemas and generation
      // instructions as agent context. Express already has a focused catalog
      // in its system prompt; those unrelated contracts exceed Nano's budget
      // and tell it to emit a different protocol.
      openGenerativeUI: browserInferenceRoute
        ? undefined
        : { sandboxFunctions: a2uiDemoSandboxFunctions },
      // Render A2UI with the basic catalog plus the dashboard components.
      a2ui: browserInferenceRoute ? undefined : { catalog: dashboardCatalog },
    }),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Ask me anything...",
      chatDisclaimerText:
        "CopilotKit Angular Demo - AI responses may need verification.",
    }),
  ],
};
