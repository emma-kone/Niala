"use client";

import { ArrowLeftRight, MousePointerClick, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { MCD_CARDINALITIES, UML_LINK_TYPES, UML_MULTIPLICITIES, type Diagram, type DiagramAttribute, type DiagramLink, type DiagramNode, type UmlLinkType } from "@/server/domain/diagram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Propriétés de l'élément sélectionné (onglet du panneau latéral) : nom, attributs, identifiant, cardinalités, type de relation…

const field = "h-8 rounded-md border bg-background px-2 text-xs";
const TYPE_LABEL: Record<DiagramNode["type"], string> = { entity: "Entité", association: "Association", class: "Classe", note: "Note" };

interface Props {
  /** Diagramme affiché, modifications en cours comprises. */
  diagram: Diagram;
  id: string | null;
  onNode: (id: string, patch: Partial<DiagramNode>) => void;
  onLink: (id: string, patch: Partial<DiagramLink>) => void;
  onDelete: (ids: string[]) => void;
  onClose: () => void;
  /** Des modifications attendent d'être enregistrées. */
  dirty: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/** Onglet « Propriétés » : les modifications se voient sur la grille et ne sont gardées qu'après « Enregistrer ». */
export function Inspector({ diagram, id, onNode, onLink, onDelete, onClose, dirty, onSave, onCancel }: Props) {
  const node = id ? diagram.nodes.find((n) => n.id === id) : undefined;
  const link = id ? diagram.links.find((l) => l.id === id) : undefined;
  if (!id || (!node && !link)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <MousePointerClick className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Aucun élément sélectionné</p>
        <p className="max-w-xs text-xs text-muted-foreground">Cliquez sur une {diagram.kind === "mcd" ? "entité, une association ou une patte" : "classe ou une relation"} de la grille pour modifier ses propriétés ici.</p>
      </div>
    );
  }
  return (
    <section aria-label="Propriétés de l'élément" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b pb-2">
        <p className="mr-auto text-sm font-semibold">{node ? TYPE_LABEL[node.type] : diagram.kind === "mcd" ? "Patte (cardinalité)" : "Relation"}</p>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete([id])} aria-label="Supprimer l'élément" title="Supprimer l'élément"><Trash2 className="h-4 w-4" aria-hidden /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Désélectionner" title="Désélectionner"><X className="h-4 w-4" aria-hidden /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3 pr-1 text-sm">
        {node && <NodeFields diagram={diagram} node={node} onNode={onNode} />}
        {link && <LinkFields diagram={diagram} link={link} onLink={onLink} />}
      </div>
      <div className="flex items-center gap-2 border-t pt-3">
        <p className="mr-auto text-[11px] text-muted-foreground" aria-live="polite">{dirty ? "Modifications non enregistrées" : "Aucune modification en attente"}</p>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={!dirty} onClick={onCancel}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Annuler</Button>
        <Button size="sm" className="h-8 gap-1 text-xs" disabled={!dirty} onClick={onSave}><Save className="h-3.5 w-3.5" aria-hidden /> Enregistrer</Button>
      </div>
    </section>
  );
}

function NodeFields({ diagram, node, onNode }: { diagram: Diagram; node: DiagramNode; onNode: Props["onNode"] }) {
  const set = (patch: Partial<DiagramNode>) => onNode(node.id, patch);
  const setAttr = (i: number, patch: Partial<DiagramAttribute>) => set({ attributes: node.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  if (node.type === "note") {
    return (
      <label className="block text-xs font-medium">
        Texte de la note
        <Textarea value={node.text ?? ""} maxLength={1000} rows={5} className="mt-1 text-sm" onChange={(e) => set({ text: e.target.value, name: e.target.value.slice(0, 40) || "Note" })} />
      </label>
    );
  }
  const uml = diagram.kind === "uml";
  return (
    <>
      <label className="block text-xs font-medium">
        Nom
        <Input data-autofocus value={node.name} maxLength={80} className="mt-1 h-8" onChange={(e) => set({ name: e.target.value || " " })} onBlur={(e) => { if (!e.target.value.trim()) set({ name: TYPE_LABEL[node.type].toUpperCase() }); }} />
      </label>
      {uml && (
        <label className="block text-xs font-medium">
          Stéréotype
          <select className={`${field} mt-1 w-full`} value={node.stereotype ?? ""} onChange={(e) => set({ stereotype: e.target.value || undefined })}>
            <option value="">(aucun)</option>
            <option value="abstract">abstract (classe abstraite)</option>
            <option value="interface">interface</option>
            <option value="enumeration">enumeration</option>
            <option value="entity">entity</option>
          </select>
        </label>
      )}
      <fieldset>
        <legend className="mb-1 text-xs font-medium">{node.type === "association" ? "Attributs portés par l'association" : "Attributs"}</legend>
        <ul className="space-y-1.5">
          {node.attributes.map((a, i) => (
            <li key={i} className="flex items-center gap-1">
              {uml && (
                <select aria-label="Visibilité" className={`${field} w-11 px-1`} value={a.visibility ?? ""} onChange={(e) => setAttr(i, { visibility: (e.target.value || undefined) as DiagramAttribute["visibility"] })}>
                  <option value="">·</option>
                  <option value="+">+</option>
                  <option value="-">-</option>
                  <option value="#">#</option>
                  <option value="~">~</option>
                </select>
              )}
              <input aria-label="Nom de l'attribut" className={`${field} min-w-0 flex-1`} value={a.name} maxLength={80} onChange={(e) => setAttr(i, { name: e.target.value || " " })} />
              {uml && <input aria-label="Type" placeholder="type" className={`${field} w-16`} value={a.type ?? ""} maxLength={40} onChange={(e) => setAttr(i, { type: e.target.value || undefined })} />}
              {node.type === "entity" && (
                <label className="flex items-center gap-1 text-[11px]" title="Identifiant de l'entité (souligné)">
                  <input type="checkbox" checked={!!a.key} onChange={(e) => setAttr(i, { key: e.target.checked || undefined })} /> id
                </label>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Retirer ${a.name}`} onClick={() => set({ attributes: node.attributes.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" aria-hidden /></Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="mt-2 h-7 gap-1 text-xs" disabled={node.attributes.length >= 40} onClick={() => set({ attributes: [...node.attributes, { name: `attribut${node.attributes.length + 1}`, ...(uml ? { visibility: "-" as const } : {}), ...(node.type === "entity" && node.attributes.length === 0 ? { key: true } : {}) }] })}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Ajouter un attribut
        </Button>
        {node.type === "entity" && <p className="mt-1 text-[11px] text-muted-foreground">Cochez « id » pour l&apos;identifiant : il est souligné et devient la clé primaire au passage au MLD.</p>}
      </fieldset>
      {node.type === "class" && (
        <label className="block text-xs font-medium">
          Opérations (une par ligne)
          <Textarea value={node.methods.join("\n")} rows={4} className="mt-1 font-code text-xs" placeholder="+ calculerTotal() : float" onChange={(e) => set({ methods: e.target.value.split("\n").map((m) => m.slice(0, 120)).filter((m, i, all) => m.trim() || i === all.length - 1).slice(0, 40) })} onBlur={(e) => set({ methods: e.target.value.split("\n").map((m) => m.trim()).filter(Boolean).slice(0, 40) })} />
        </label>
      )}
    </>
  );
}

function LinkFields({ diagram, link, onLink }: { diagram: Diagram; link: DiagramLink; onLink: Props["onLink"] }) {
  const set = (patch: Partial<DiagramLink>) => onLink(link.id, patch);
  const a = diagram.nodes.find((n) => n.id === link.from)?.name ?? "?";
  const b = diagram.nodes.find((n) => n.id === link.to)?.name ?? "?";
  if (diagram.kind === "mcd") {
    return (
      <>
        <p className="text-xs text-muted-foreground">Entre l&apos;entité <strong className="text-foreground">{a}</strong> et l&apos;association <strong className="text-foreground">{b}</strong>.</p>
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Cardinalité côté {a}</legend>
          <div className="grid grid-cols-4 gap-1">
            {MCD_CARDINALITIES.map((c) => (
              <button key={c} type="button" aria-pressed={link.cardFrom === c} onClick={() => set({ cardFrom: c })} className={`rounded-md border px-1 py-1.5 font-code text-xs ${link.cardFrom === c ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{c}</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Minimum puis maximum de fois qu&apos;une occurrence de {a} participe à {b}.</p>
        </fieldset>
      </>
    );
  }
  const multiplicity = (label: string, value: string | undefined, on: (v: string | undefined) => void) => (
    <label className="block text-xs font-medium">
      {label}
      <select className={`${field} mt-1 w-full`} value={value ?? ""} onChange={(e) => on(e.target.value || undefined)}>
        <option value="">(aucune)</option>
        {UML_MULTIPLICITIES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  );
  const hint: Record<UmlLinkType, string> = {
    association: "Lien entre deux classes.",
    inheritance: `${a} hérite de ${b} (flèche vers la classe mère).`,
    composition: `${a} est un composant de ${b} : il disparaît avec lui (losange plein côté ${b}).`,
    aggregation: `${a} fait partie de ${b} sans en dépendre (losange vide côté ${b}).`,
    dependency: `${a} utilise ${b} (flèche pointillée).`,
  };
  return (
    <>
      <label className="block text-xs font-medium">
        Type de relation
        <select className={`${field} mt-1 w-full`} value={link.type} onChange={(e) => set({ type: e.target.value as DiagramLink["type"], ...(e.target.value === "inheritance" ? { cardFrom: undefined, cardTo: undefined } : {}) })}>
          {Object.entries(UML_LINK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <p className="text-[11px] text-muted-foreground">{hint[link.type as UmlLinkType]}</p>
      {link.type !== "inheritance" && (
        <div className="grid grid-cols-2 gap-2">
          {multiplicity(`Côté ${a}`, link.cardFrom, (v) => set({ cardFrom: v }))}
          {multiplicity(`Côté ${b}`, link.cardTo, (v) => set({ cardTo: v }))}
        </div>
      )}
      <label className="block text-xs font-medium">
        Nom ou rôle
        <Input value={link.label ?? ""} maxLength={80} className="mt-1 h-8" placeholder="ex. suit, possède…" onChange={(e) => set({ label: e.target.value || undefined })} />
      </label>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => set({ from: link.to, to: link.from, cardFrom: link.cardTo, cardTo: link.cardFrom })}>
        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden /> Inverser le sens
      </Button>
    </>
  );
}
