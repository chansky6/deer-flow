import "server-only";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db";
import { genericOAuth } from "better-auth/plugins";

import { env } from "@/env";
import { getDatabasePool } from "@/server/db";

const pool = getDatabasePool();
const baseURL = env.BETTER_AUTH_BASE_URL?.trim();
const trustedOrigins = [
  baseURL,
  ...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
].flatMap((origin) => {
  const normalizedOrigin = origin?.trim();
  return normalizedOrigin ? [normalizedOrigin] : [];
});
const hasGithubProvider = Boolean(
  env.BETTER_AUTH_GITHUB_CLIENT_ID && env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
);
const hasOidcProvider = Boolean(
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET,
);

export const auth = betterAuth({
  baseURL,
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
  secret: env.BETTER_AUTH_SECRET,
  database: pool,
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "oidc"],
    },
  },
  user: {
    additionalFields: {
      isAdmin: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const result = await pool.query('SELECT COUNT(*)::int AS count FROM "user"');
          const isFirstUser = Number(result.rows[0]?.count ?? 0) === 0;
          return {
            data: {
              ...user,
              isAdmin: isFirstUser,
            },
          };
        },
      },
    },
  },
  socialProviders: hasGithubProvider
    ? {
        github: {
          clientId: env.BETTER_AUTH_GITHUB_CLIENT_ID!,
          clientSecret: env.BETTER_AUTH_GITHUB_CLIENT_SECRET!,
        },
      }
    : undefined,
  plugins: hasOidcProvider
    ? [
        genericOAuth({
          config: [
            {
              providerId: "oidc",
              clientId: env.OIDC_CLIENT_ID!,
              clientSecret: env.OIDC_CLIENT_SECRET!,
              discoveryUrl: env.OIDC_ISSUER!,
              scopes: ["openid", "profile", "email"],
              pkce: true,
            },
          ],
        }),
      ]
    : [],
});

let readyPromise: Promise<void> | null = null;

export function ensureBetterAuthReady() {
  readyPromise ??= getMigrations(auth.options)
    .then(({ runMigrations }) => runMigrations())
    .then(() => undefined);
  return readyPromise;
}

export type Session = typeof auth.$Infer.Session;
