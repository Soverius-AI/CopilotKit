import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";
import {
  createGenerativeUI,
  provideGenerativeUI,
  standardUI,
} from "@copilotkit/angular/generative-ui";
import {
  ChromeExpressAgent,
  EXPRESS_AGENT_ID,
} from "./routes/a2ui-1.0/chrome-express-agent";

/** Keep the trained catalog identity and native standard components, without
 * the shop tools, other demo routes, Inspector, runtime URL or server agents. */
export const expressOnlyUI = createGenerativeUI({
  id: "copilotkit/demo-shop@1",
  extends: [standardUI],
  components: {},
});

export const expressOnlyConfig: ApplicationConfig = {
  providers: [
    provideGenerativeUI({ ui: expressOnlyUI }),
    provideCopilotKit({
      licenseKey: "ck_pub_00000000000000000000000000000000",
      enableInspector: false,
      agents: { [EXPRESS_AGENT_ID]: new ChromeExpressAgent() },
      suggestionsConfig: [],
    }),
  ],
};
