import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { loginAdminWithPassword } from "@/server/admin/auth";
import { requestMeta, setAdminCookie, getAdmin } from "@/server/admin/session";
import { landingFor } from "@/server/admin/rbac";

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  return handle(async () => {
    const meta = await requestMeta();
    limit(`admin-login:ip:${meta.ip ?? "?"}`, 20, 10 * 60_000);
    const { email, password } = schema.parse(await readJson<unknown>(req));
    limit(`admin-login:${email.toLowerCase()}`, 8, 10 * 60_000);
    const result = await loginAdminWithPassword(email, password, meta);
    await setAdminCookie(result.userId, result.version);
    return NextResponse.json({ ok: true, landing: result.landing });
  });
}

export async function GET() {
  return handle(async () => {
    const admin = await getAdmin();
    return admin ? { authenticated: true, landing: landingFor(admin.role) } : { authenticated: false };
  });
}
