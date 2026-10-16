import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Sign in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  return <AuthForm mode="login" notice={(await searchParams).notice} />;
}