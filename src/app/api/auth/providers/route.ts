import { NextResponse } from "next/server";

const SETTINGS_CACHE_SECONDS = 60;

/** Moyens de connexion activés : lus dans la configuration publique de Supabase Auth (clé publique uniquement). */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ google: false });
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, next: { revalidate: SETTINGS_CACHE_SECONDS } });
    if (!res.ok) return NextResponse.json({ google: false });
    const settings = (await res.json()) as { external?: { google?: boolean } };
    return NextResponse.json({ google: settings.external?.google === true });
  } catch {
    return NextResponse.json({ google: false });
  }
}
