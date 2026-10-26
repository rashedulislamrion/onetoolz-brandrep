import { requireAccess } from "@/lib/auth/access";
import { AppShell } from "@/components/app-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAccess("affiliate");
  return <AppShell area="partner" email={user.email ?? ""}>{children}</AppShell>;
}
