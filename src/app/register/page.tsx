import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create account" };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  return <AuthForm mode="register" notice={(await searchParams).notice} />;
}