// Génère le code d'accès du back-office et son hachage.
// Usage : node scripts/admin-access-code.mjs            -> code aléatoire (3 mots + 4 chiffres), affiché UNE fois
//         SF_ACCESS_CODE="mon code" node scripts/admin-access-code.mjs   -> hache le code de votre choix
// Mettez la ligne ADMIN_ACCESS_HASH=… dans .env ET dans les variables de Vercel. Le code, lui, ne se stocke nulle part.
import { randomBytes, randomInt, scryptSync } from "node:crypto";

const WORDS = "aigle ardoise argile aurore balise banquise basalte bambou bruyere buisson cactus cairn calanque canyon carmin cascade cedre cerise chene cigale cime citron corail cormoran crete cristal delta dune ecume eglantine emeraude epine erable etang falaise fenouil fougere fjord flamant fontaine foret fresque galet geyser gingembre glacier glycine gorge granit grotte hameau heron hibou horizon iceberg indigo iris jade jasmin jonc lagune lavande lichen liege lilas lotus lucane lune magnolia mangue marais menthe mesa meteore mimosa mousse myrtille narcisse nenuphar nuage oasis ocelot olivier onyx orchidee orage ortie ourse paon pampa pervenche pivoine plage platane pluie prairie quartz rafale raisin recif rivage roseau rubis safran sapin saule sauge savane schiste sequoia sierra sommet source sterne sureau tamaris tilleul topaze toundra tulipe vallee vanille vent verger vigne violette volcan zenith zephyr".split(" ");
const given = process.env.SF_ACCESS_CODE?.trim();
if (given && given.length < 8) {
  console.error("Le code doit contenir au moins 8 caractères.");
  process.exit(1);
}
const code = given ?? `${Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).join("-")}-${randomInt(1000, 10000)}`;
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(code.toLowerCase(), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
if (!given) console.log(`Code d'accès (à noter maintenant, il ne sera plus affiché) : ${code}\n`);
console.log(`ADMIN_ACCESS_HASH=${salt}.${hash}`);
