import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_DATABASE_URL: z.string().optional(),
    BACKEND_BASE_URL: z.string().optional(),
    BETTER_AUTH_BASE_URL: z.string().url().optional(),
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    BETTER_AUTH_GITHUB_CLIENT_ID: z.string().optional(),
    BETTER_AUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
    INTERNAL_AUTH_JWT_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    INTERNAL_AUTH_JWT_TTL_SECONDS: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),
    OIDC_ISSUER: z.string().optional(),
    GITHUB_OAUTH_TOKEN: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_BACKEND_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_LANGGRAPH_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_STATIC_WEBSITE_ONLY: z.string().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
    BACKEND_BASE_URL: process.env.BACKEND_BASE_URL,
    BETTER_AUTH_BASE_URL: process.env.BETTER_AUTH_BASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    BETTER_AUTH_GITHUB_CLIENT_ID: process.env.BETTER_AUTH_GITHUB_CLIENT_ID,
    BETTER_AUTH_GITHUB_CLIENT_SECRET:
      process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
    INTERNAL_AUTH_JWT_SECRET: process.env.INTERNAL_AUTH_JWT_SECRET,
    INTERNAL_AUTH_JWT_TTL_SECONDS: process.env.INTERNAL_AUTH_JWT_TTL_SECONDS,
    NODE_ENV: process.env.NODE_ENV,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_ISSUER: process.env.OIDC_ISSUER,

    NEXT_PUBLIC_BACKEND_BASE_URL: process.env.NEXT_PUBLIC_BACKEND_BASE_URL,
    NEXT_PUBLIC_LANGGRAPH_BASE_URL: process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL,
    NEXT_PUBLIC_STATIC_WEBSITE_ONLY:
      process.env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY,
    GITHUB_OAUTH_TOKEN: process.env.GITHUB_OAUTH_TOKEN,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
