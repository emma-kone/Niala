-- Niala : le thème par défaut devient « system » (celui de l'appareil).
-- Seule la valeur attribuée aux nouveaux comptes change : les comptes existants gardent leur choix,
-- puisque « light » et « dark » ne se distinguent pas d'un choix explicite.
ALTER TABLE "public"."UserSettings" ALTER COLUMN "theme" SET DEFAULT 'system';
