import { redirect } from "next/navigation";

import { WorkspaceLayoutClient } from "@/components/workspace/workspace-layout-client";
import { getAppSession } from "@/server/auth/session";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAppSession();
  if (!session) {
    redirect("/sign-in?next=/workspace");
  }

  return <WorkspaceLayoutClient>{children}</WorkspaceLayoutClient>;
}
