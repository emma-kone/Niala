// Attribue (ou retire) un rôle d'administration à un compte Niala. C'est la seule façon de créer le PREMIER super administrateur ;
// ensuite, les rôles se gèrent depuis « Paramètres d'administration ».
// Usage : node scripts/grant-admin.mjs <email> [SUPER_ADMIN|ADMIN|SUPPORT|ANALYST|NONE]   (défaut : SUPER_ADMIN)
// Pour créer le compte en même temps :
//   node scripts/grant-admin.mjs <email> SUPER_ADMIN --create --generate-password [--name "Nom"]   (mot de passe aléatoire affiché UNE fois)
//   SF_PASSWORD=... node scripts/grant-admin.mjs <email> SUPER_ADMIN --create [--name "Nom"]          (mot de passe de votre choix)
// Le mot de passe n'est jamais passé en argument ni enregistré en clair. Seul un compte déjà inscrit peut être promu sans --create.
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const ROLES = ["SUPER_ADMIN", "ADMIN", "SUPPORT", "ANALYST", "NONE"];
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--") && a.includes("@"))?.toLowerCase().trim();
const role = (args.find((a) => ROLES.includes(a)) ?? "SUPER_ADMIN").toUpperCase();
const create = args.includes("--create");
const generate = args.includes("--generate-password");
const nameIdx = args.indexOf("--name");
const name = nameIdx >= 0 ? args[nameIdx + 1] : undefined;

if (!email) {
  console.error("Usage : node scripts/grant-admin.mjs <email> [SUPER_ADMIN|ADMIN|SUPPORT|ANALYST|NONE] [--create --name \"Nom\"]");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const generated = create && generate && !process.env.SF_PASSWORD ? randomBytes(12).toString("base64url") : null;
    const password = generated ?? process.env.SF_PASSWORD;
    if (!create || !password || password.length < 10) {
      console.error("Aucun compte avec cette adresse. Inscrivez-vous d'abord sur Niala, ou utilisez --create avec --generate-password (ou SF_PASSWORD, 10 caractères minimum).");
      process.exit(1);
    }
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    user = await prisma.user.create({ data: { email, name: name ?? null, passwordHash: `scrypt$${salt}$${hash}`, settings: { create: {} } } });
    console.log("Compte créé.");
    if (generated) console.log(`
Identifiants de connexion (à noter maintenant, ils ne seront plus affichés) :
  e-mail       : ${email}
  mot de passe : ${generated}
`);
  }
  await prisma.user.update({ where: { id: user.id }, data: { adminRole: role === "NONE" ? null : role, ...(role === "NONE" ? { sessionVersion: { increment: 1 } } : {}) } });
  await prisma.adminAuditLog.create({ data: { actorId: null, actorEmail: "script:grant-admin", action: "admin.role", targetType: "user", targetId: user.id, detail: { email, from: user.adminRole, to: role === "NONE" ? null : role } } });
  console.log(role === "NONE" ? `Accès d'administration retiré à ${email}.` : `${email} est maintenant ${role}. Connexion : /admin/login`);
} finally {
  await prisma.$disconnect();
}
