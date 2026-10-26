import { requireAccess } from "@/lib/auth/access";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAccess("admin");
  return <AppShell area="admin" email={user.email ?? ""}>{children}</AppShell>;
}
