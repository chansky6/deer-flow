import { headers } from "next/headers";
import { cache } from "react";

import { auth } from ".";
import { ensureBetterAuthReady } from "./config";

export const getSession = cache(async () => {
  await ensureBetterAuthReady();
  return auth.api.getSession({ headers: await headers() });
});
