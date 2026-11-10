/**
 * Adresse publique de Niala pour les liens envoyés aux étudiants. APP_URL (ex. https://niala.app) est prioritaire :
 * elle évite qu'un en-tête Host falsifié produise un lien vers un autre site.
 */
export function appOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(req.url).origin;
}
