-- Identifiant Google lié à un compte (un compte inscrit par mot de passe peut aussi se connecter avec Google).
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
