import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, Bot, CalendarDays, CheckCircle2, ClipboardCheck, Code2, LifeBuoy, LineChart, Lock, Network, NotebookPen, Smartphone, Sparkles, Upload } from "lucide-react";
import { NialaLogo } from "@/components/brand/niala-logo";
import { routes } from "@/config/routes";

// ─────────────────────────────────────────────────────────────────────────────
// Page d'accueil publique : présente Niala et ses modules (captures réelles d'un compte de démonstration, données
// fictives) avant l'inscription. Affichée à « / » pour les visiteurs non connectés, et à /accueil pour tous.
// ─────────────────────────────────────────────────────────────────────────────

const signup = `${routes.login}?mode=inscription`;

interface Module {
  id: string;
  icon: typeof BookOpen;
  title: string;
  text: string;
  points: string[];
  image: string;
  alt: string;
}

const MODULES: Module[] = [
  {
    id: "matieres",
    icon: BookOpen,
    title: "Tous vos cours, rangés par matière",
    text: "Importez vos PDF, présentations et documents Word. Niala les classe par matière et par dossier, en extrait le texte et en dégage le plan et les notions clés.",
    points: ["Lecteur intégré qui reprend à la bonne page", "Recherche dans le contenu de vos cours", "Plan, notions et définitions extraits automatiquement"],
    image: "/accueil/matiere.webp",
    alt: "Liste des documents de la matière Algorithmique dans Niala",
  },
  {
    id: "assistant",
    icon: Bot,
    title: "Un assistant IA qui s'appuie sur vos cours",
    text: "Posez vos questions : l'assistant lit les passages utiles de vos documents pour répondre, explique pas à pas et vous dit clairement ce qu'il a consulté.",
    points: ["Explications, fiches de révision, exemples de code", "Réponses en français ou en anglais", "Recherche web facultative, avec sources citées"],
    image: "/accueil/assistant.webp",
    alt: "Conversation avec l'assistant IA de Niala expliquant la récursivité",
  },
  {
    id: "exercices",
    icon: ClipboardCheck,
    title: "Des exercices générés à partir de vos documents",
    text: "QCM, vrai ou faux, phrases à compléter, questions ouvertes, code ou SQL : choisissez le nombre de questions, le barème et la difficulté. La correction est détaillée, question par question.",
    points: ["Note exacte selon votre barème", "Explication de chaque réponse", "Tuteur pour comprendre une erreur"],
    image: "/accueil/correction.webp",
    alt: "Correction détaillée d'un exercice d'algorithmique, note de 16,75 sur 20",
  },
  {
    id: "cartes",
    icon: Network,
    title: "Des cartes mentales pour relier les notions",
    text: "Générez une carte à partir d'un cours ou construisez la vôtre : nœuds, relations, réorganisation automatique et historique des versions.",
    points: ["Carte de structure ou carte conceptuelle", "Édition libre au clavier et à la souris", "Points de restauration automatiques"],
    image: "/accueil/carte-mentale.webp",
    alt: "Carte mentale du modèle OSI avec ses sept couches",
  },
  {
    id: "agenda",
    icon: CalendarDays,
    title: "Votre emploi du temps et vos devoirs",
    text: "Importez votre emploi du temps (PDF, image, tableur) ou saisissez vos cours, puis ajoutez devoirs, projets et révisions. Niala vous rappelle ce qui arrive.",
    points: ["Semaines A et B, salles et enseignants", "Tâches, échéances et séances de travail planifiées", "Rappels sur votre appareil"],
    image: "/accueil/agenda.webp",
    alt: "Vue semaine de l'agenda avec les cours de la semaine",
  },
  {
    id: "notes",
    icon: NotebookPen,
    title: "Des notes reliées à vos documents",
    text: "Prenez des notes riches, surlignez un passage pour en faire une annotation, et retrouvez toutes vos notes par matière.",
    points: ["Éditeur de texte complet", "Citations rattachées à la page du cours", "Recherche dans toutes vos notes"],
    image: "/accueil/notes.webp",
    alt: "Liste des notes classées par matière",
  },
  {
    id: "progression",
    icon: LineChart,
    title: "Une progression mesurée par notion",
    text: "Chaque réponse corrigée enrichit votre niveau de maîtrise, notion par notion, avec un indice de confiance. Vous savez exactement quoi retravailler.",
    points: ["Maîtrise par notion et par matière", "Historique de vos résultats", "Suggestions de révision ciblées"],
    image: "/accueil/progression.webp",
    alt: "Page de progression avec la maîtrise par notion",
  },
  {
    id: "labos",
    icon: Code2,
    title: "Des laboratoires de code et de SQL",
    text: "Écrivez et exécutez du Python, du JavaScript ou du SQL directement dans Niala, librement ou face à des tests extraits de vos TP.",
    points: ["Exécution isolée et sûre", "Tests objectifs, sans résultat simulé", "Historique de vos exécutions"],
    image: "/accueil/labo-code.webp",
    alt: "Éditeur de code de Niala",
  },
];

const STEPS = [
  { icon: Upload, title: "Importez vos cours", text: "Déposez vos supports : Niala les organise et les analyse." },
  { icon: Sparkles, title: "Apprenez avec l'IA", text: "Questions, explications, exercices et cartes, à partir de vos propres documents." },
  { icon: LineChart, title: "Mesurez vos progrès", text: "Suivez votre maîtrise notion par notion et révisez au bon moment." },
];

const FAQ = [
  { q: "Qu'est-ce que Niala ?", a: "Un espace de travail pour étudiants qui réunit vos cours, un assistant IA, des exercices corrigés, des cartes mentales, vos notes, votre agenda et le suivi de votre progression." },
  { q: "Qui peut s'inscrire ?", a: "Tous les étudiants : Niala est pensé avec les étudiants de l'ESATIC et reste ouvert aux étudiants des autres établissements. L'inscription se fait par e-mail ou avec un compte Google." },
  { q: "Mes documents sont-ils privés ?", a: "Oui. Vos fichiers sont stockés dans un espace privé et chaque compte n'accède qu'à ses propres données. Les détails sont dans la politique de confidentialité." },
  { q: "Faut-il installer une application ?", a: "Non : Niala fonctionne dans le navigateur, sur ordinateur comme sur téléphone. Vous pouvez aussi l'ajouter à l'écran d'accueil pour l'ouvrir comme une application et recevoir des notifications." },
  { q: "J'ai un problème pour me connecter.", a: "Utilisez le bouton « Assistance » : l'équipe vous répond par e-mail, sans que vous ayez besoin d'être connecté." },
];

function Shot({ src, alt, priority }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-[var(--niala-accent)]/10">
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
      </div>
      <Image src={src} alt={alt} width={1440} height={900} priority={priority} sizes="(min-width: 1024px) 640px, 100vw" className="h-auto w-full" />
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          <Link href={routes.welcome} aria-label="Niala — accueil"><NialaLogo size="md" /></Link>
          <nav aria-label="Sections" className="ml-6 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#modules" className="hover:text-foreground">Modules</a>
            <a href="#fonctionnement" className="hover:text-foreground">Comment ça marche</a>
            <a href="#faq" className="hover:text-foreground">Questions</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href={routes.login} className="whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-medium hover:bg-muted sm:px-3"><span className="sm:hidden">Connexion</span><span className="hidden sm:inline">Se connecter</span></Link>
            <Link href={signup} className="whitespace-nowrap rounded-xl bg-[var(--niala-accent)] px-3 py-2 text-sm font-semibold text-[var(--niala-accent-foreground)] hover:opacity-90 sm:px-3.5"><span className="sm:hidden">S&apos;inscrire</span><span className="hidden sm:inline">Créer un compte</span></Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_35%_35%,var(--accent-lilac),transparent_65%)] opacity-80" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:py-20">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-[var(--niala-accent)]" aria-hidden />L&apos;espace d&apos;étude des étudiants</p>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Vos cours, un assistant IA et votre progression, au même endroit.</h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">Niala range vos documents, vous explique ce que vous ne comprenez pas, génère des exercices corrigés à partir de vos cours et mesure votre maîtrise, notion par notion.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={signup} className="inline-flex items-center gap-2 rounded-2xl bg-[var(--niala-accent)] px-5 py-3 text-base font-semibold text-[var(--niala-accent-foreground)] shadow-lg shadow-[var(--niala-accent)]/25 hover:opacity-90">Commencer maintenant <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <a href="#modules" className="inline-flex items-center gap-2 rounded-2xl border bg-card px-5 py-3 text-base font-medium hover:bg-muted">Découvrir les modules</a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-1.5"><Lock className="h-4 w-4" aria-hidden />Documents privés</li>
                <li className="flex items-center gap-1.5"><Smartphone className="h-4 w-4" aria-hidden />Ordinateur et téléphone</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden />En français et en anglais</li>
              </ul>
            </div>
            <Shot src="/accueil/tableau-de-bord.webp" alt="Tableau de bord de Niala : cours à reprendre, journée du jour, tâches et suggestions" priority />
          </div>
        </section>

        <section id="fonctionnement" className="border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">Comment ça marche</h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-3xl border bg-card p-6 shadow-sm">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--niala-accent)]/12 text-[var(--niala-accent)]"><s.icon className="h-5 w-5" aria-hidden /></span>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Étape {i + 1}</p>
                  <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="modules" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Tout ce qu&apos;il faut pour réussir votre semestre</h2>
            <p className="mt-3 text-muted-foreground">Huit modules qui travaillent ensemble. Captures réalisées sur un compte de démonstration.</p>
          </div>
          <div className="mt-14 space-y-20">
            {MODULES.map((m, i) => (
              <article key={m.id} id={m.id} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
                <div className={i % 2 ? "lg:order-2" : undefined}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--niala-accent)]/12 text-[var(--niala-accent)]"><m.icon className="h-5 w-5" aria-hidden /></span>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight">{m.title}</h3>
                  <p className="mt-3 text-muted-foreground">{m.text}</p>
                  <ul className="mt-5 space-y-2">
                    {m.points.map((p) => <li key={p} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--niala-accent)]" aria-hidden />{p}</li>)}
                  </ul>
                </div>
                <div className={i % 2 ? "lg:order-1" : undefined}><Shot src={m.image} alt={m.alt} /></div>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className="border-t bg-muted/40">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <h2 className="text-center text-3xl font-bold tracking-tight">Questions fréquentes</h2>
            <div className="mt-8 space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-2xl border bg-card p-5 shadow-sm">
                  <summary className="cursor-pointer list-none font-semibold marker:hidden">{f.q}</summary>
                  <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="rounded-[2rem] bg-[#1c1530] px-6 py-12 text-center text-white sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight">Prêt à travailler plus sereinement ?</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/70">Créez votre compte en une minute et importez votre premier cours.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href={signup} className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 font-semibold text-[#1c1530] hover:bg-white/90">Créer mon compte <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href={routes.login} className="rounded-2xl border border-white/30 px-5 py-3 font-medium hover:bg-white/10">J&apos;ai déjà un compte</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <NialaLogo size="sm" />
          <Link href={routes.privacy} className="hover:text-foreground">Confidentialité</Link>
          <Link href={routes.terms} className="hover:text-foreground">Conditions d&apos;utilisation</Link>
          <Link href={routes.assistance} className="inline-flex items-center gap-1.5 hover:text-foreground"><LifeBuoy className="h-4 w-4" aria-hidden />Assistance</Link>
          <span className="ml-auto">© {new Date().getFullYear()} Niala</span>
        </div>
      </footer>
    </div>
  );
}
