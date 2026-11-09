"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Paramètres de Niala, regroupés selon ce que l'étudiant cherche à faire. Chaque ligne agit réellement :
// la valeur est enregistrée sur le compte puis lue par le module concerné. Les réglages propres à un exercice ou
// à l'agenda restent dans ces modules : ils ne sont pas répétés ici.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, BookOpenCheck, Download, Loader2, LogOut, MonitorSmartphone, ShieldCheck, SlidersHorizontal, Trash2, UserRound, XCircle, type LucideIcon } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { notify } from "@/components/notifications";
import { applyTextSize, useTheme, type ThemeChoice } from "@/components/theme/theme-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EXERCISE_MODES, MODE_META } from "@/server/domain/exercise-types";
import { useAppStore } from "@/store/app-store";
import { PROFILE_KEY, fetchProfile, profileSummary, type Profile } from "@/features/profile/types";
import { UserAvatar } from "@/features/profile/user-avatar";
import { useSettings, type UserSettings } from "./use-settings";

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "compte", label: "Mon compte", icon: UserRound },
  { id: "preferences", label: "Préférences générales", icon: SlidersHorizontal },
  { id: "apprentissage", label: "Apprentissage", icon: BookOpenCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "donnees", label: "Confidentialité et données", icon: ShieldCheck },
];

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function Section({ id, title, text, children }: { id: string; title: string; text: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-3xl border bg-card p-5">
      <h2 id={`${id}-title`} className="typo-h2">{title}</h2>
      <p className="typo-meta mt-0.5">{text}</p>
      <div className="mt-2 divide-y">{children}</div>
    </section>
  );
}

function Row({ title, text, htmlFor, children }: { title: string; text?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {htmlFor ? <Label htmlFor={htmlFor} className="text-sm font-medium">{title}</Label> : <p className="text-sm font-medium">{title}</p>}
        {text && <p className="typo-meta mt-0.5">{text}</p>}
      </div>
      <div className="min-w-0 sm:shrink-0">{children}</div>
    </div>
  );
}

function Choice<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full sm:w-56"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// ── A. Mon compte ────────────────────────────────────────────────────────────

function EmailForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.put<{ email: string }>("/api/account/email", { email, password });
      qc.setQueryData(PROFILE_KEY, { ...profile, email: r.email });
      if (user) setAuthenticated(true, { ...user, email: r.email });
      notify({ title: "Adresse e-mail modifiée", description: r.email, variant: "success" });
      setOpen(false);
      setPassword("");
    } catch (err) {
      setProblem(errorText(err, "Modification impossible."));
    } finally {
      setBusy(false);
    }
  }

  if (!profile.auth.password) return <p className="typo-meta max-w-56 sm:text-right">Gérée par votre compte Google.</p>;
  if (!open) return <Button type="button" variant="outline" size="sm" onClick={() => { setEmail(profile.email); setOpen(true); }}>Modifier</Button>;
  return (
    <form onSubmit={submit} className="w-full space-y-2 sm:w-72">
      <Input type="email" required aria-label="Nouvelle adresse e-mail" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input type="password" required aria-label="Mot de passe actuel" placeholder="Mot de passe actuel" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
        <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Enregistrer</Button>
      </div>
    </form>
  );
}

function PasswordForm({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setProblem("Le nouveau mot de passe doit contenir au moins 10 caractères.");
    setBusy(true);
    setProblem(null);
    try {
      await api.put("/api/account/password", { current, next });
      notify({ title: "Mot de passe modifié", description: "Vos autres appareils ont été déconnectés.", variant: "success" });
      setOpen(false);
      setCurrent("");
      setNext("");
    } catch (err) {
      setProblem(errorText(err, "Modification impossible."));
    } finally {
      setBusy(false);
    }
  }

  if (!profile.auth.password) return <p className="typo-meta max-w-56 sm:text-right">Connexion avec Google, sans mot de passe Niala.</p>;
  if (!open) return <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Modifier</Button>;
  return (
    <form onSubmit={submit} className="w-full space-y-2 sm:w-72">
      <Input type="password" required aria-label="Mot de passe actuel" placeholder="Mot de passe actuel" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input type="password" required minLength={10} aria-label="Nouveau mot de passe" placeholder="Nouveau mot de passe (10 caractères minimum)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
        <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Enregistrer</Button>
      </div>
    </form>
  );
}

function AccountSection({ profile }: { profile: Profile | undefined }) {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await api.del("/api/account/sessions");
      notify({ title: "Autres appareils déconnectés", description: "Cet appareil reste connecté.", variant: "success" });
    } catch (e) {
      notify({ title: "Action impossible", description: errorText(e, ""), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.post("/api/auth/logout");
    window.location.replace(routes.login);
  }

  return (
    <Section id="compte" title="Mon compte" text="Votre identité et l'accès à votre compte.">
      {!profile ? (
        <Skeleton className="my-3 h-24 w-full rounded-2xl" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 py-3.5">
            <UserAvatar name={profile.name} email={profile.email} avatar={profile.avatar} className="h-14 w-14 text-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{profile.name ?? "Mon compte"}</p>
              <p className="typo-meta truncate">{[...profileSummary(profile).map((r) => r.value)].join(" · ") || "Profil à compléter"}</p>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={routes.profile}>Mon profil <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
          </div>
          <Row title="Adresse e-mail" text={profile.email}><EmailForm profile={profile} /></Row>
          <Row title="Mot de passe"><PasswordForm profile={profile} /></Row>
        </>
      )}
      <Row title="Sessions" text="Une session reste ouverte 7 jours sur chaque appareil.">
        <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full gap-1.5 whitespace-normal text-left" disabled={busy} onClick={() => void revoke()}><MonitorSmartphone className="h-4 w-4" aria-hidden /> Déconnecter mes autres appareils</Button>
      </Row>
      <Row title="Déconnexion">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void logout()}><LogOut className="h-4 w-4" aria-hidden /> Se déconnecter</Button>
      </Row>
    </Section>
  );
}

// ── E. Confidentialité et données ────────────────────────────────────────────

function DeleteAccount({ profile }: { profile: Profile }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const withPassword = profile.auth.password;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api.request("DELETE", "/api/account", withPassword ? { password: value } : { confirmEmail: value });
      window.location.replace(routes.login);
    } catch (err) {
      setProblem(errorText(err, "Suppression impossible."));
      setBusy(false);
    }
  }

  return (
    <AlertDialog onOpenChange={() => { setValue(""); setProblem(null); }}>
      <AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm" className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" aria-hidden /> Supprimer mon compte</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={confirm} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer définitivement votre compte ?</AlertDialogTitle>
            <AlertDialogDescription>Vos matières, documents, notes, cartes, exercices, résultats, conversations et votre agenda seront effacés. Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">{withPassword ? "Confirmez avec votre mot de passe" : "Recopiez votre adresse e-mail pour confirmer"}</Label>
            <Input id="delete-confirm" required type={withPassword ? "password" : "email"} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
            {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Annuler</AlertDialogCancel>
            <Button type="submit" disabled={busy || !value} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Supprimer définitivement</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Vue principale ───────────────────────────────────────────────────────────

export default function SettingsView() {
  const { settings, error, save } = useSettings();
  const { data: profile } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile });
  const { theme, setTheme } = useTheme();
  const [maxUpload, setMaxUpload] = useState<string | null>(null);
  const uploadValue = maxUpload ?? String(settings?.maxUploadMB ?? "");
  const uploadParsed = Number.parseInt(uploadValue, 10);
  const uploadValid = Number.isInteger(uploadParsed) && uploadParsed >= 1 && uploadParsed <= 50;

  // Arrivée par un lien vers une section (« modifier dans Paramètres »).
  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, [profile]);

  async function update(patch: Partial<UserSettings>) {
    try {
      await save(patch);
      notify({ title: "Préférence enregistrée", variant: "success", durationMs: 2500 });
    } catch (e) {
      notify({ title: "Enregistrement impossible", description: errorText(e, ""), variant: "error" });
    }
  }

  async function changeTheme(value: ThemeChoice) {
    const previous = theme;
    setTheme(value);
    try {
      await save({ theme: value });
      notify({ title: "Préférence enregistrée", variant: "success", durationMs: 2500 });
    } catch (e) {
      setTheme(previous);
      notify({ title: "Enregistrement impossible", description: errorText(e, ""), variant: "error" });
    }
  }

  async function changeTextSize(value: UserSettings["textSize"]) {
    applyTextSize(value);
    await update({ textSize: value });
  }

  const toggle = (id: keyof UserSettings, title: string, text: string) => (
    <Row title={title} text={text} htmlFor={`setting-${id}`}>
      <Switch id={`setting-${id}`} checked={!!settings?.[id]} onCheckedChange={(v) => void update({ [id]: v })} aria-label={title} />
    </Row>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="typo-h1">Paramètres</h1>
        <p className="typo-subtitle mt-1">Votre compte et vos préférences. Les réglages d&apos;un exercice ou de l&apos;agenda se trouvent dans ces modules.</p>
      </header>
      {error && !settings && (
        <Alert variant="destructive" className="mt-4"><XCircle aria-hidden /><AlertTitle>Chargement impossible</AlertTitle><AlertDescription>{errorText(error, "Réessayez dans un instant.")}</AlertDescription></Alert>
      )}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections des paramètres" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={cn("flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground")}>
              <s.icon className="h-4 w-4 shrink-0" aria-hidden /> {s.label}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          <AccountSection profile={profile} />

          {!settings ? (
            <Skeleton className="h-96 rounded-3xl" aria-hidden />
          ) : (
            <>
              <Section id="preferences" title="Préférences générales" text="L'apparence et la langue de Niala.">
                <Row title="Langue de l'interface" text="Niala est disponible en français. D'autres langues seront proposées ici lorsqu'elles existeront."><span className="text-sm font-medium">Français</span></Row>
                <Row title="Langue des exercices" text="Langue des énoncés générés, des explications et du tuteur." htmlFor="setting-lang">
                  <Choice id="setting-lang" value={settings.exerciseLang} onChange={(v) => void update({ exerciseLang: v })} options={[{ value: "fr", label: "Français" }, { value: "en", label: "Anglais" }]} />
                </Row>
                <Row title="Thème" htmlFor="setting-theme">
                  <Choice id="setting-theme" value={theme} onChange={(v) => void changeTheme(v)} options={[{ value: "system", label: "Système" }, { value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }]} />
                </Row>
                <Row title="Taille du texte" text="Agrandit l'ensemble de l'interface." htmlFor="setting-text">
                  <Choice id="setting-text" value={settings.textSize} onChange={(v) => void changeTextSize(v)} options={[{ value: "normal", label: "Normale" }, { value: "large", label: "Grande" }]} />
                </Row>
                <Row title="Taille maximale des fichiers importés" text="Entre 1 et 50 Mo par fichier." htmlFor="setting-upload">
                  <div className="flex items-start gap-2">
                    <div>
                      <Input id="setting-upload" type="number" min={1} max={50} className="tnum w-24" value={uploadValue} onChange={(e) => setMaxUpload(e.target.value)} />
                      {!uploadValid && <p className="typo-meta mt-1 text-destructive">Entre 1 et 50.</p>}
                    </div>
                    <Button type="button" size="sm" variant="outline" disabled={!uploadValid || uploadParsed === settings.maxUploadMB} onClick={() => void update({ maxUploadMB: uploadParsed }).then(() => setMaxUpload(null))}>Enregistrer</Button>
                  </div>
                </Row>
              </Section>

              <Section id="apprentissage" title="Apprentissage" text="Valeurs proposées à la création d'un exercice ; vous pouvez les changer pour chaque exercice.">
                <Row title="Mode d'exercice par défaut" text={MODE_META[settings.defaultMode].text} htmlFor="setting-mode">
                  <Choice id="setting-mode" value={settings.defaultMode} onChange={(v) => void update({ defaultMode: v })} options={EXERCISE_MODES.map((m) => ({ value: m, label: MODE_META[m].label }))} />
                </Row>
                <Row title="Correction" text="Moment où la correction s'affiche par défaut (toujours à la fin en mode Examen)." htmlFor="setting-correction">
                  <Choice id="setting-correction" value={settings.correctionPref} onChange={(v) => void update({ correctionPref: v })} options={[{ value: "final", label: "À la fin de l'exercice" }, { value: "immediate", label: "Après chaque réponse" }]} />
                </Row>
                {toggle("hintsEnabled", "Indices du tuteur", "Permet de demander des indices progressifs pendant un exercice.")}
                <Row title="Explications de l'IA" text="Niveau de détail du tuteur, adapté aussi à votre niveau d'études." htmlFor="setting-explanations">
                  <Choice id="setting-explanations" value={settings.explanationLevel} onChange={(v) => void update({ explanationLevel: v })} options={[{ value: "simple", label: "Simples" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Approfondies" }]} />
                </Row>
              </Section>

              <Section id="notifications" title="Notifications" text="Messages affichés dans Niala. Les rappels de cours et leurs horaires se règlent dans l'agenda.">
                {toggle("notifyProgress", "Progression", "Votre résultat et sa prise en compte à la fin d'un exercice.")}
                {toggle("notifyRevision", "Rappels de révision", "Au plus une fois par jour, les notions qu'il est utile de retravailler.")}
                {toggle("notifyActivities", "Activités et exercices", "Cours, séances de travail, échéances et retards de votre agenda.")}
              </Section>
            </>
          )}

          <Section id="donnees" title="Confidentialité et données" text="Vos données vous appartiennent.">
            <Row title="Utilisation de vos données" text="Ce que Niala collecte, pourquoi, et qui y accède.">
              <Button asChild variant="outline" size="sm"><Link href={routes.privacy}>Politique de confidentialité</Link></Button>
            </Row>
            <Row title="Copie de vos données" text="Profil, préférences, matières, notes, exercices et résultats, au format JSON.">
              <Button asChild variant="outline" size="sm" className="gap-1.5"><a href="/api/account/export" download><Download className="h-4 w-4" aria-hidden /> Télécharger</a></Button>
            </Row>
            {profile && <Row title="Supprimer mon compte" text="Efface définitivement votre compte et tous vos contenus."><DeleteAccount profile={profile} /></Row>}
          </Section>
        </div>
      </div>
    </div>
  );
}
