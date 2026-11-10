"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Settings, Trash2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { notify } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { AcademicFields, EMPTY_ACADEMIC, Required, checkAcademic, type AcademicDraft } from "./academic-fields";
import { PROFILE_KEY, fetchProfile, type Profile } from "./types";
import { UserAvatar } from "./user-avatar";

const AVATAR_SIZE = 256;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Recadre la photo au carré et la réduit dans le navigateur : le serveur ne reçoit qu'une petite image. */
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

const draftOf = (p: Profile): AcademicDraft => ({
  ...EMPTY_ACADEMIC,
  category: p.category,
  institution: p.category === "OTHER_SCHOOL" ? (p.institution ?? "") : "",
  field: p.category === "TESTER" ? "" : (p.field ?? ""),
  situation: p.situation ?? "",
  usageReason: p.usageReason ?? "",
});

export default function ProfileView() {
  const qc = useQueryClient();
  const { data: profile, error, refetch } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile });
  const user = useAppStore((s) => s.user);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const [name, setName] = useState("");
  const [academic, setAcademic] = useState<AcademicDraft>(EMPTY_ACADEMIC);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!profile || loaded.current) return;
    loaded.current = true;
    setName(profile.name ?? "");
    setAcademic(draftOf(profile));
  }, [profile]);

  function applied(p: Profile) {
    qc.setQueryData(PROFILE_KEY, p);
    if (user) setAuthenticated(true, { ...user, name: p.name, avatar: p.avatar, profileComplete: !!p.category });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem("Indiquez votre nom et prénom.");
    const checked = checkAcademic(academic);
    if (!checked.ok) return setProblem(checked.message);
    setSaving(true);
    try {
      const r = await api.put<{ profile: Profile }>("/api/profile", { name: name.trim(), academic: checked.value });
      applied(r.profile);
      setAcademic(draftOf(r.profile));
      notify({ title: "Profil enregistré", variant: "success" });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return notify({ title: "Format non pris en charge", description: "Choisissez une image.", variant: "error" });
    if (file.size > MAX_SOURCE_BYTES) return notify({ title: "Image trop volumineuse", description: "8 Mo maximum.", variant: "error" });
    await sendPhoto(() => shrinkImage(file));
  }

  async function sendPhoto(make: () => Promise<string | null>) {
    setPhotoBusy(true);
    try {
      applied((await api.put<{ profile: Profile }>("/api/profile", { avatar: await make() })).profile);
    } catch (err) {
      notify({ title: "Photo non enregistrée", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setPhotoBusy(false);
    }
  }

  if (error && !profile) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">Profil indisponible</h1>
        <Button className="mt-6" variant="outline" onClick={() => void refetch()}>Réessayer</Button>
      </div>
    );
  }
  if (!profile) return <div className="mx-auto max-w-2xl space-y-3 px-4 py-8" aria-busy><Skeleton className="h-9 w-48" /><Skeleton className="h-96 rounded-3xl" /></div>;

  return (
    <form onSubmit={save} className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="typo-h1">Mon profil</h1>
          <p className="typo-subtitle mt-1">Vos informations personnelles et votre parcours.</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={routes.settings}><Settings className="h-4 w-4" aria-hidden /> Paramètres</Link></Button>
      </header>

      <section aria-labelledby="profile-personal" className="space-y-4 rounded-3xl border bg-card p-5">
        <h2 id="profile-personal" className="font-semibold">Informations personnelles</h2>
        <div className="flex items-center gap-4">
          <UserAvatar name={profile.name} email={profile.email} avatar={profile.avatar} className="h-16 w-16 text-2xl" />
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void changePhoto(f); }} />
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={photoBusy} onClick={() => input.current?.click()}>
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />} {profile.avatar ? "Changer la photo" : "Ajouter une photo"}
            </Button>
            {profile.avatar && <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={photoBusy} onClick={() => void sendPhoto(async () => null)}><Trash2 className="h-4 w-4" aria-hidden /> Retirer</Button>}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-name">Nom et prénom<Required /></Label>
          <Input id="profile-name" required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Adresse e-mail</p>
          <p className="text-sm text-muted-foreground">{profile.email} · <Link href={`${routes.settings}#compte`} className="underline underline-offset-2 hover:text-foreground">modifier dans Paramètres</Link></p>
        </div>
      </section>

      <section aria-labelledby="profile-academic" className="space-y-4 rounded-3xl border bg-card p-5">
        <h2 id="profile-academic" className="font-semibold">Parcours</h2>
        {!profile.category && <p className="typo-meta -mt-2">Complétez votre parcours : Niala adapte les exercices et les explications à votre niveau.</p>}
        <AcademicFields draft={academic} onChange={setAcademic} idPrefix="profile" />
      </section>

      {problem && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{problem}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="typo-meta"><span className="text-destructive">*</span> Champ obligatoire</p>
        <Button type="submit" disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Enregistrer</Button>
      </div>
    </form>
  );
}
