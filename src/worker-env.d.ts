import type { DocumentStore } from "./storage";
import type { Env } from "./router";

declare module "hono" {
  interface ContextVariableMap {
    store: DocumentStore;
  }

  interface HonoEnv {
    Bindings: Env;
    Variables: {
      store: DocumentStore;
    };
  }
}
