import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Reset your password" };
export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  return <AuthForm mode="forgot" notice={(await searchParams).notice} />;
}