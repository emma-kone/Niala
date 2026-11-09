import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL } from "./legal";
import { routes } from "./routes";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("pages légales", () => {
  it("renseignent un contact valide et un site en https", () => {
    expect(LEGAL.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(LEGAL.siteUrl).toMatch(/^https:\/\/[^/\s]+$/);
    expect(LEGAL.updatedAt.length).toBeGreaterThan(5);
  });

  it("ne contiennent aucun texte provisoire", () => {
    for (const file of ["src/app/(legal)/confidentialite/page.tsx", "src/app/(legal)/conditions/page.tsx"]) {
      expect(read(file)).not.toMatch(/TODO|XXX|lorem|\[à compléter\]|\[nom\]/i);
    }
  });

  it("sont publiques : hors du groupe protégé par la connexion", () => {
    expect(routes.privacy).toBe("/confidentialite");
    expect(routes.terms).toBe("/conditions");
    expect(read("src/app/(legal)/layout.tsx")).not.toMatch(/AuthGuard|AppShell/);
  });

  it("décrivent les prestataires réellement utilisés", () => {
    const privacy = read("src/app/(legal)/confidentialite/page.tsx");
    for (const provider of ["Supabase", "Vercel", "Google Gemini", "Tavily"]) expect(privacy).toContain(provider);
  });

  it("sont accessibles depuis l'écran de connexion", () => {
    const login = read("src/features/auth/login-view.tsx");
    expect(login).toContain("routes.privacy");
    expect(login).toContain("routes.terms");
  });
});
