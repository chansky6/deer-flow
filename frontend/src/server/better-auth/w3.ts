import "server-only";

import { env } from "@/env";

type W3Profile = Record<string, unknown>;

const DEFAULT_SCOPE_SEPARATOR = ",";

function getConfiguredField(override: string | undefined, fallback: string[]) {
  return override?.trim() ? [override.trim()] : fallback;
}

function isRecord(value: unknown): value is W3Profile {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getProfileSources(profile: W3Profile) {
  const sources: W3Profile[] = [profile];
  const data = profile.data;
  const user = profile.user;

  if (isRecord(data)) {
    sources.unshift(data);
  }
  if (isRecord(user)) {
    sources.unshift(user);
  }

  return sources;
}

function getFieldValue(profile: W3Profile, keys: string[]) {
  for (const source of getProfileSources(profile)) {
    for (const key of keys) {
      if (key in source) {
        return source[key];
      }
    }
  }
  return undefined;
}

function getStringValue(profile: W3Profile, override: string | undefined, fallback: string[]) {
  const value = getFieldValue(profile, getConfiguredField(override, fallback));
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getIdValue(profile: W3Profile) {
  const value = getFieldValue(
    profile,
    getConfiguredField(env.W3_OAUTH_USER_ID_FIELD, [
      "id",
      "sub",
      "uuid",
      "userId",
      "user_id",
      "uid",
      "employee_id",
    ]),
  );

  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function getBooleanValue(
  profile: W3Profile,
  override: string | undefined,
  fallback: string[],
) {
  const value = getFieldValue(profile, getConfiguredField(override, fallback));
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

function getOptionalEmail(profile: W3Profile) {
  const value = getFieldValue(
    profile,
    getConfiguredField(env.W3_OAUTH_USER_EMAIL_FIELD, ["email", "mail"]),
  );
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getFallbackName(id: string | number) {
  return String(id);
}

function getFallbackEmail(id: string | number) {
  return `${String(id)}@w3.local`;
}

function getW3ScopeValue() {
  const explicitScopes = env.W3_OAUTH_SCOPES?.trim();
  if (explicitScopes) {
    return explicitScopes;
  }
  return getW3OAuthScopes().join(DEFAULT_SCOPE_SEPARATOR);
}

function getW3ErrorMessage(profile: W3Profile) {
  const errorCode = typeof profile.errorCode === "string" ? profile.errorCode.trim() : "";
  const errorDesc = typeof profile.errorDesc === "string" ? profile.errorDesc.trim() : "";
  if (!errorCode && !errorDesc) {
    return null;
  }

  if (errorCode && errorDesc) {
    return `W3 userinfo request was rejected (${errorCode}): ${errorDesc}`;
  }
  return `W3 userinfo request was rejected: ${errorCode || errorDesc}`;
}

export function isW3OAuthConfigured() {
  return Boolean(
    env.W3_OAUTH_CLIENT_ID &&
      env.W3_OAUTH_CLIENT_SECRET &&
      env.W3_OAUTH_AUTHORIZATION_URL &&
      env.W3_OAUTH_TOKEN_URL &&
      env.W3_OAUTH_USERINFO_URL,
  );
}

export function getW3OAuthScopes() {
  return (env.W3_OAUTH_SCOPES ?? "")
    .split(DEFAULT_SCOPE_SEPARATOR)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function isW3PkceEnabled() {
  const value = env.W3_OAUTH_PKCE?.trim().toLowerCase();
  return value !== "false" && value !== "0";
}

export function createW3OAuthConfig() {
  if (!isW3OAuthConfigured()) {
    return null;
  }

  return {
    providerId: "w3",
    clientId: env.W3_OAUTH_CLIENT_ID!,
    clientSecret: env.W3_OAUTH_CLIENT_SECRET!,
    authorizationUrl: env.W3_OAUTH_AUTHORIZATION_URL!,
    tokenUrl: env.W3_OAUTH_TOKEN_URL!,
    userInfoUrl: env.W3_OAUTH_USERINFO_URL!,
    scopes: getW3OAuthScopes(),
    pkce: isW3PkceEnabled(),
    async getUserInfo(tokens: { accessToken?: string }) {
      if (!tokens.accessToken) {
        throw new Error("W3 OAuth token response is missing access_token.");
      }

      const body = new URLSearchParams({
        access_token: tokens.accessToken,
        client_id: env.W3_OAUTH_CLIENT_ID!,
      });
      const scope = getW3ScopeValue();
      if (scope) {
        body.set("scope", scope);
      }

      const response = await fetch(env.W3_OAUTH_USERINFO_URL!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/plain, */*",
        },
        body,
        cache: "no-store",
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `W3 userinfo request failed with status ${response.status}: ${responseText}`,
        );
      }

      let profile: unknown;
      try {
        profile = responseText ? (JSON.parse(responseText) as unknown) : null;
      } catch {
        throw new Error("W3 userinfo response must be valid JSON.");
      }

      if (!isRecord(profile)) {
        throw new Error("W3 userinfo response must be a JSON object.");
      }

      const apiErrorMessage = getW3ErrorMessage(profile);
      if (apiErrorMessage) {
        throw new Error(apiErrorMessage);
      }

      const id = getIdValue(profile);
      if (id === undefined) {
        throw new Error(
          `W3 userinfo response is missing a usable id field. Top-level keys: ${Object.keys(
            profile,
          ).join(", ")}`,
        );
      }

      return {
        id,
        email: getOptionalEmail(profile) ?? getFallbackEmail(id),
        name:
          getStringValue(profile, env.W3_OAUTH_USER_NAME_FIELD, [
            "name",
            "display_name",
            "displayName",
            "userName",
            "username",
          ]) ?? getFallbackName(id),
        image: getStringValue(profile, env.W3_OAUTH_USER_IMAGE_FIELD, [
          "picture",
          "avatar",
          "avatar_url",
          "avatarUrl",
        ]),
        emailVerified: getBooleanValue(
          profile,
          env.W3_OAUTH_USER_EMAIL_VERIFIED_FIELD,
          ["email_verified", "emailVerified", "mailVerified"],
        ),
      };
    },
  };
}
