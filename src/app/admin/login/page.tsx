import { redirect } from "next/navigation";
import { AdminLoginView } from "@/features/admin/login-view";
import { getAdmin } from "@/server/admin/session";
import { landingFor } from "@/server/admin/rbac";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await getAdmin();
  if (admin) redirect(landingFor(admin.role));
  return <AdminLoginView initialError={(await searchParams).error ?? null} />;
}
