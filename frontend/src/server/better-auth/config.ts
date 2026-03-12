import "server-only";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db";
import { genericOAuth } from "better-auth/plugins";

import { env } from "@/env";
import { createW3OAuthConfig, isW3OAuthConfigured } from "@/server/better-auth/w3";
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
const hasW3Provider = isW3OAuthConfigured();
const trustedProviders = [
  ...(hasGithubProvider ? ["github"] : []),
  ...(hasOidcProvider ? ["oidc"] : []),
  ...(hasW3Provider ? ["w3"] : []),
];
const genericOAuthProviders = [
  ...(hasOidcProvider
    ? [
        {
          providerId: "oidc",
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET!,
          discoveryUrl: env.OIDC_ISSUER!,
          scopes: ["openid", "profile", "email"],
          pkce: true,
        },
      ]
    : []),
  ...(hasW3Provider ? [createW3OAuthConfig()!] : []),
];

export const auth = betterAuth({
  baseURL,
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
  secret: env.BETTER_AUTH_SECRET,
  database: pool,
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders,
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
  plugins: genericOAuthProviders.length > 0
    ? [
        genericOAuth({
          config: genericOAuthProviders,
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
