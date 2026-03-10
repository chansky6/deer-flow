import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, inferAdditionalFields } from "better-auth/client/plugins";

import type { auth } from "./config";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient(), inferAdditionalFields<typeof auth>()],
});

export type Session = typeof authClient.$Infer.Session;
