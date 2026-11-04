-- Niala : le thème par défaut devient « dark ».
-- Les comptes qui avaient encore l'ancienne valeur par défaut (« system », attribuée à tous avant ce changement)
-- passent en « dark » ; un choix explicite « light » ou « dark » n'est jamais modifié.
-- Réversible depuis la page Réglages.
ALTER TABLE "public"."UserSettings" ALTER COLUMN "theme" SET DEFAULT 'dark';
UPDATE "public"."UserSettings" SET "theme" = 'dark' WHERE "theme" = 'system';
