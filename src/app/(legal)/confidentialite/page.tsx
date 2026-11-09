import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { LEGAL } from "@/config/legal";
import { routes } from "@/config/routes";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Niala",
  description: "Quelles données Niala traite, pourquoi, avec qui elles sont partagées et comment exercer vos droits.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Politique de confidentialité" intro={`${LEGAL.appName} est une plateforme d'apprentissage assistée par intelligence artificielle : vous y importez vos cours, vous générez des exercices et vous suivez votre progression. Cette page explique, simplement, quelles données sont traitées, pourquoi, avec qui elles sont partagées et comment garder la main dessus.`}>
      <LegalSection id="responsable" title="1. Qui est responsable de vos données ?">
        <p>
          Le responsable du traitement est l&apos;éditeur de {LEGAL.appName}{LEGAL.publisher ? ` (${LEGAL.publisher})` : ""}. Pour toute question ou pour exercer vos droits, écrivez à <ContactLink />.
        </p>
      </LegalSection>

      <LegalSection id="donnees" title="2. Les données que nous traitons">
        <ul>
          <li><strong>Votre compte :</strong> votre nom, votre adresse e-mail et, si vous vous inscrivez avec un mot de passe, ce mot de passe, conservé uniquement sous forme chiffrée (jamais en clair).</li>
          <li><strong>Votre profil :</strong> votre catégorie (étudiant ESATIC, étudiant d&apos;un autre établissement ou testeur) et, selon le cas, votre établissement, votre filière, votre niveau d&apos;études, votre situation et votre motif d&apos;utilisation, ainsi que la photo que vous choisissez d&apos;ajouter. Ces informations servent à adapter les exercices et les explications ; vous pouvez les modifier à tout moment.</li>
          <li><strong>La connexion avec Google :</strong> Google nous transmet votre nom, votre adresse e-mail (vérifiée) et votre photo de profil. Nous conservons le nom et l&apos;adresse e-mail ; la photo n&apos;est pas enregistrée. Nous ne recevons ni votre mot de passe Google, ni l&apos;accès à votre Gmail, votre Drive, vos contacts ou votre agenda Google.</li>
          <li><strong>Vos contenus :</strong> vos matières, les documents que vous importez (PDF, Word, PowerPoint, texte, Markdown) et le texte qui en est extrait et analysé, vos notes et cartes, vos exercices, réponses et résultats, votre progression, vos conversations avec l&apos;assistant, votre emploi du temps et vos tâches, ainsi que le code et les requêtes SQL saisis dans les laboratoires.</li>
          <li><strong>Vos préférences :</strong> thème, mode d&apos;exercice par défaut, taille maximale d&apos;import, etc.</li>
          <li><strong>Des données techniques :</strong> les journaux de fonctionnement tenus par nos hébergeurs (adresse IP, date, erreurs) et des statistiques d&apos;utilisation du service d&apos;IA (nombre d&apos;appels, durée, taille des échanges), sans leur contenu.</li>
        </ul>
        <p>Nous n&apos;utilisons aucun outil de mesure d&apos;audience, aucune publicité et aucun suivi à des fins commerciales.</p>
      </LegalSection>

      <LegalSection id="finalites" title="3. Pourquoi nous les utilisons">
        <ul>
          <li><strong>Vous fournir le service</strong> (créer votre compte, stocker vos documents, générer et corriger des exercices, répondre à vos questions, suivre votre progression) : c&apos;est l&apos;exécution des conditions d&apos;utilisation que vous acceptez en créant un compte.</li>
          <li><strong>Sécuriser le service</strong> (limiter les abus, détecter les anomalies) : notre intérêt légitime à protéger la plateforme et ses utilisateurs.</li>
          <li><strong>Vous permettre de vous connecter avec Google</strong> : à votre demande, quand vous choisissez ce mode de connexion.</li>
        </ul>
        <p>Vos données ne sont ni vendues ni louées, et ne servent pas à vous profiler à des fins publicitaires.</p>
      </LegalSection>

      <LegalSection id="ia" title="4. Intelligence artificielle et recherche web">
        <p>
          Quand vous utilisez l&apos;assistant, l&apos;analyse d&apos;un document, la génération d&apos;exercices ou leur correction, les passages utiles de vos documents, vos questions et vos réponses sont envoyés au service d&apos;IA <strong>Google Gemini</strong> pour produire le résultat. Lorsque la recherche web est activée, des requêtes de recherche tirées de votre question peuvent être envoyées à un service de recherche (Tavily, ou Wikipédia).
        </p>
        <p>
          Ces envois ne se font que lorsque vous utilisez ces fonctions. Les conditions de ces prestataires s&apos;appliquent à leur traitement. Évitez d&apos;importer des informations sensibles (santé, opinions, données d&apos;autres personnes) si vous ne souhaitez pas qu&apos;elles soient traitées de cette manière.
        </p>
      </LegalSection>

      <LegalSection id="destinataires" title="5. Qui reçoit vos données ?">
        <p>Seuls les prestataires techniques nécessaires au fonctionnement de {LEGAL.appName} y accèdent :</p>
        <ul>
          <li><strong>Supabase :</strong> base de données, authentification et stockage privé de vos fichiers (région Europe de l&apos;Ouest, Londres).</li>
          <li><strong>Vercel :</strong> hébergement de l&apos;application.</li>
          <li><strong>Google :</strong> connexion avec Google et service d&apos;IA Gemini.</li>
          <li><strong>Tavily :</strong> recherche web, lorsque vous l&apos;activez dans l&apos;assistant.</li>
        </ul>
        <p>Nous pouvons aussi communiquer des données si la loi ou une autorité compétente nous y oblige.</p>
      </LegalSection>

      <LegalSection id="transferts" title="6. Transferts hors de l'Union européenne">
        <p>
          Certains de ces prestataires (hébergement, IA, recherche web) peuvent traiter des données hors de l&apos;Union européenne, notamment aux États-Unis, et le Royaume-Uni pour la base de données. Ces transferts reposent sur les mécanismes prévus par le RGPD : décision d&apos;adéquation ou clauses contractuelles types.
        </p>
      </LegalSection>

      <LegalSection id="duree" title="7. Combien de temps nous les gardons">
        <ul>
          <li>Vos données de compte et vos contenus sont conservés tant que votre compte existe.</li>
          <li>Vous pouvez télécharger une copie de vos données et supprimer votre compte depuis Paramètres. La suppression efface vos données. Des copies peuvent subsister quelque temps dans les sauvegardes de nos prestataires, jusqu&apos;à leur renouvellement.</li>
          <li>Les journaux techniques sont conservés pour une durée limitée, selon les règles de nos hébergeurs.</li>
        </ul>
      </LegalSection>

      <LegalSection id="cookies" title="8. Cookies et stockage local">
        <ul>
          <li>Un <strong>cookie de session</strong> (<code>sfs_session</code>, 7 jours) vous garde connecté. Il est indispensable au fonctionnement et réservé à votre navigateur.</li>
          <li>Pendant la connexion avec Google, des cookies techniques temporaires de Supabase peuvent être utilisés.</li>
          <li>Le <strong>stockage local</strong> de votre navigateur retient vos préférences d&apos;affichage (thème, barre latérale réduite, recherche web dans l&apos;assistant).</li>
        </ul>
        <p>Nous n&apos;utilisons aucun cookie publicitaire ni de mesure d&apos;audience : aucun bandeau de consentement n&apos;est donc nécessaire.</p>
      </LegalSection>

      <LegalSection id="securite" title="9. Sécurité">
        <p>
          Les échanges sont chiffrés (HTTPS), les mots de passe sont chiffrés, vos fichiers sont stockés dans un espace privé et chaque compte n&apos;accède qu&apos;à ses propres données. Aucun système n&apos;est infaillible : nous ne pouvons pas garantir une sécurité absolue, mais nous traitons ce sujet avec sérieux.
        </p>
      </LegalSection>

      <LegalSection id="droits" title="10. Vos droits">
        <p>Vous pouvez à tout moment demander :</p>
        <ul>
          <li>l&apos;accès à vos données et une copie de celles-ci (portabilité) ;</li>
          <li>la rectification des informations inexactes ;</li>
          <li>l&apos;effacement de vos données et de votre compte ;</li>
          <li>la limitation du traitement, ou vous y opposer pour des raisons tenant à votre situation ;</li>
          <li>le retrait de votre consentement lorsque le traitement repose dessus.</li>
        </ul>
        <p>
          Écrivez à <ContactLink /> : nous répondons dans un délai d&apos;un mois. Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">www.cnil.fr</a>).
        </p>
      </LegalSection>

      <LegalSection id="mineurs" title="11. Mineurs">
        <p>
          {LEGAL.appName} s&apos;adresse aux étudiants. En France, un mineur de moins de 15 ans doit disposer de l&apos;accord de ses parents ou de son représentant légal pour créer un compte.
        </p>
      </LegalSection>

      <LegalSection id="modifications" title="12. Modifications de cette politique">
        <p>
          Nous pouvons mettre cette politique à jour, par exemple lorsqu&apos;une fonctionnalité évolue. La date en haut de page indique la dernière version. Voir aussi nos <Link href={routes.terms}>conditions d&apos;utilisation</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
