import { redirect } from "next/navigation";

import { AdminLayoutClient } from "@/components/admin/admin-layout-client";
import { getAppSession } from "@/server/auth/session";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAppSession();
  if (!session) {
    redirect("/sign-in?next=/admin");
  }
  if (!session.isAdmin) {
    redirect("/workspace");
  }

  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
