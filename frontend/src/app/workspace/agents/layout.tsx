import { redirect } from "next/navigation";

export default function AgentsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  void children;
  redirect("/workspace/chats");
}
