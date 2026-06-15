import { createRequestHandler } from "react-router";
import { initEnv } from "../app/lib/env.server";

declare global {
  interface CloudflareEnvironment extends Env {}
}

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnvironment;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext) {
    // Initialize environment bindings so lib files can use getEnv().
    // Safe to call on every request — subsequent calls are no-ops.
    initEnv({
      POCKETBASE_URL: env.POCKETBASE_URL as string,
      POCKETBASE_SUPER_TOKEN: env.POCKETBASE_SUPER_TOKEN as string,
      ALLOWED_ORIGINS: env.ALLOWED_ORIGINS as string,
    });

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
