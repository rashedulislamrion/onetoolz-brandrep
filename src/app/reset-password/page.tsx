import { AuthForm } from "@/components/auth-form";
import { requireIdentity } from "@/lib/auth/access";
export const metadata = { title: "Choose a password" };
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireIdentity();
  return <AuthForm mode="reset" notice={(await searchParams).notice} />;
}