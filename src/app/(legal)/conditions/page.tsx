import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { LEGAL } from "@/config/legal";
import { routes } from "@/config/routes";

export const metadata: Metadata = {
  title: "Conditions d'utilisation — Niala",
  description: "Les règles d'utilisation de Niala : compte, contenus, intelligence artificielle, usage acceptable et responsabilités.",
};

export default function TermsPage() {
  return (
    <LegalDocument title="Conditions d'utilisation" intro={`Ces conditions encadrent l'utilisation de ${LEGAL.appName}. En créant un compte ou en vous connectant, vous les acceptez. Si vous n'êtes pas d'accord, n'utilisez pas le service.`}>
      <LegalSection id="service" title="1. Le service">
        <p>
          {LEGAL.appName} est une plateforme d&apos;apprentissage assistée par IA. Elle permet notamment d&apos;importer ses cours, de les analyser, de générer et corriger des exercices, de dialoguer avec un assistant, de pratiquer le code et le SQL, d&apos;organiser son emploi du temps et de suivre sa progression. Le service évolue : des fonctions peuvent être ajoutées, modifiées ou retirées.
        </p>
      </LegalSection>

      <LegalSection id="compte" title="2. Votre compte">
        <ul>
          <li>Vous pouvez vous inscrire avec une adresse e-mail et un mot de passe, ou avec Google.</li>
          <li>Les informations fournies doivent être exactes. Le compte est personnel : ne le partagez pas.</li>
          <li>Vous êtes responsable de la confidentialité de vos identifiants et de l&apos;activité de votre compte. Prévenez-nous rapidement en cas d&apos;utilisation suspecte.</li>
          <li>Vous pouvez demander la suppression de votre compte à tout moment, à <ContactLink />.</li>
        </ul>
      </LegalSection>

      <LegalSection id="contenus" title="3. Vos contenus">
        <ul>
          <li><strong>Ils restent les vôtres.</strong> Nous ne revendiquons aucun droit de propriété sur vos documents, notes, exercices ou réponses.</li>
          <li><strong>Vous garantissez avoir le droit de les importer</strong> : vos propres cours et notes, ou des documents que vous êtes autorisé à utiliser. N&apos;importez pas de contenus illicites, ni de documents dont vous n&apos;avez pas le droit de vous servir.</li>
          <li><strong>Vous nous autorisez à les traiter</strong> uniquement pour faire fonctionner le service pour vous : les stocker, en extraire le texte, les analyser et les transmettre aux prestataires techniques nécessaires, dont le service d&apos;IA, comme l&apos;explique la <Link href={routes.privacy}>politique de confidentialité</Link>.</li>
          <li>Conservez une copie de vos documents originaux : le service n&apos;est pas un espace de sauvegarde.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ia" title="4. Intelligence artificielle : une aide, pas une certitude">
        <ul>
          <li>Les réponses, résumés, exercices et corrections produits par l&apos;IA peuvent contenir des erreurs ou des oublis, même lorsqu&apos;ils citent des sources ou affichent un indice de fiabilité.</li>
          <li>Les notes et les évaluations sont indicatives : elles ne remplacent ni un enseignant, ni une évaluation officielle, ni un conseil médical, juridique ou financier.</li>
          <li>Vérifiez les informations importantes auprès de votre cours ou de sources fiables.</li>
          <li>Vous restez responsable de l&apos;usage que vous faites de ces résultats, notamment au regard des règles de votre établissement sur l&apos;usage de l&apos;IA et sur le plagiat.</li>
        </ul>
      </LegalSection>

      <LegalSection id="usage" title="5. Ce qui est interdit">
        <ul>
          <li>Accéder à un compte ou à des données qui ne sont pas les vôtres, ou tenter de contourner la sécurité du service.</li>
          <li>Surcharger le service, contourner les limites d&apos;usage, ou extraire ses contenus de manière automatisée et massive.</li>
          <li>Utiliser les laboratoires de code et de SQL pour tenter de s&apos;échapper de leur environnement isolé, attaquer d&apos;autres systèmes ou exécuter des programmes malveillants.</li>
          <li>Importer ou produire des contenus illicites, haineux, ou portant atteinte aux droits d&apos;autrui.</li>
        </ul>
      </LegalSection>

      <LegalSection id="disponibilite" title="6. Disponibilité du service">
        <p>
          Nous faisons au mieux pour que {LEGAL.appName} soit disponible, mais il est fourni en l&apos;état, sans garantie de fonctionnement continu. Le service peut être interrompu pour maintenance, ou limité lorsque les quotas des services d&apos;IA sont atteints.
        </p>
      </LegalSection>

      <LegalSection id="responsabilite" title="7. Responsabilité">
        <p>
          Dans la limite permise par la loi, nous ne sommes pas responsables des dommages indirects, des pertes de données ou des conséquences d&apos;une erreur de l&apos;IA. Aucune stipulation de ces conditions ne limite les droits que la loi vous reconnaît impérativement, notamment en tant que consommateur.
        </p>
      </LegalSection>

      <LegalSection id="propriete" title="8. Propriété du service">
        <p>
          Le code, le design, le nom et la marque {LEGAL.appName} appartiennent à son éditeur. Votre accès est personnel et non transférable ; il ne vous donne aucun droit de copier, revendre ou redistribuer le service.
        </p>
      </LegalSection>

      <LegalSection id="suspension" title="9. Suspension et fin d'accès">
        <p>
          Vous pouvez cesser d&apos;utiliser {LEGAL.appName} et demander la suppression de votre compte à tout moment. Nous pouvons suspendre ou fermer un compte en cas de non-respect de ces conditions ou d&apos;usage abusif, en vous en informant lorsque c&apos;est possible.
        </p>
      </LegalSection>

      <LegalSection id="donnees" title="10. Données personnelles">
        <p>
          Le traitement de vos données est décrit dans la <Link href={routes.privacy}>politique de confidentialité</Link>, qui fait partie de ces conditions.
        </p>
      </LegalSection>

      <LegalSection id="modifications" title="11. Modifications des conditions">
        <p>
          Nous pouvons modifier ces conditions. La date en haut de page indique la dernière version ; continuer à utiliser le service après une modification vaut acceptation. Pour un changement important, nous vous en informerons dans l&apos;application.
        </p>
      </LegalSection>

      <LegalSection id="droit" title="12. Droit applicable et contact">
        <p>
          Ces conditions sont régies par le droit français, sous réserve des règles impératives de protection des consommateurs applicables dans votre pays de résidence. Pour toute question : <ContactLink />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
