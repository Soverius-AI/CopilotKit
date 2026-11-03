import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { A2ui10DemoComponent } from "./app/routes/a2ui-1.0/a2ui-1.0-demo/a2ui-1.0-demo.component";
import { expressOnlyConfig } from "./app/express-only.config";

bootstrapApplication(A2ui10DemoComponent, {
  providers: [provideZonelessChangeDetection(), ...expressOnlyConfig.providers],
}).catch((error) => console.error(error));
