// Crée un compte Niala (aucun compte par défaut n'existe en V2).
// Usage : node scripts/create-user.mjs <email> <nom> [--reset]
// Le mot de passe est lu dans la variable d'environnement SF_PASSWORD (jamais en argument).
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const [email, name] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const reset = process.argv.includes("--reset");
const password = process.env.SF_PASSWORD;

if (!email || !password) {
  console.error("Usage : SF_PASSWORD=... node scripts/create-user.mjs <email> [nom] [--reset]");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Le mot de passe doit contenir au moins 10 caractères.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
const passwordHash = `scrypt$${salt}$${hash}`;
const normalized = email.toLowerCase().trim();

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing && !reset) {
    console.error("Ce compte existe déjà (ajoutez --reset pour changer son mot de passe).");
    process.exit(1);
  }
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
    console.log("Mot de passe mis à jour.");
  } else {
    await prisma.user.create({ data: { email: normalized, name: name ?? null, passwordHash, settings: { create: {} } } });
    console.log("Compte créé.");
  }
} finally {
  await prisma.$disconnect();
}
