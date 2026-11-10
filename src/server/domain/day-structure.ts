// Structure d'une journée déduite de l'emploi du temps lui-même : aucun horaire n'est imposé. Les heures de début et de
// fin viennent des cours et des pauses réellement saisis ou importés ; les trous entre eux deviennent des périodes libres.

export interface TimedCourse { startMinutes: number; endMinutes: number; title: string }
export interface TimedBreak { startMinutes: number; endMinutes: number; label: string }
export type Segment = { kind: "course" | "break" | "free"; startMinutes: number; endMinutes: number; labels: string[] };

/** Découpe la journée en cours, pauses et périodes libres, du premier début à la dernière fin. */
export function dayStructure(courses: TimedCourse[], breaks: TimedBreak[], minFreeMinutes = 5): Segment[] {
  const items = [
    ...courses.map((c) => ({ kind: "course" as const, startMinutes: c.startMinutes, endMinutes: c.endMinutes, label: c.title })),
    ...breaks.map((b) => ({ kind: "break" as const, startMinutes: b.startMinutes, endMinutes: b.endMinutes, label: b.label })),
  ]
    .filter((i) => i.endMinutes > i.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const out: Segment[] = [];
  for (const i of items) {
    const last = out[out.length - 1];
    if (last && i.startMinutes < last.endMinutes) {
      // Chevauchement : deux éléments du même type sont réunis ; un cours l'emporte sur une pause.
      if (last.kind === i.kind) {
        last.endMinutes = Math.max(last.endMinutes, i.endMinutes);
        if (!last.labels.includes(i.label)) last.labels.push(i.label);
        continue;
      }
      if (i.kind === "break") {
        if (i.endMinutes > last.endMinutes) out.push({ kind: "break", startMinutes: last.endMinutes, endMinutes: i.endMinutes, labels: [i.label] });
        continue;
      }
      last.endMinutes = i.startMinutes;
      if (last.endMinutes <= last.startMinutes) out.pop();
    } else if (last && i.startMinutes - last.endMinutes >= minFreeMinutes) {
      out.push({ kind: "free", startMinutes: last.endMinutes, endMinutes: i.startMinutes, labels: [] });
    }
    out.push({ kind: i.kind, startMinutes: i.startMinutes, endMinutes: i.endMinutes, labels: [i.label] });
  }
  return out;
}

/** Créneaux horaires distincts réellement utilisés par les cours (ex. 08:00–10:00, 10:15–12:15), triés. */
export function timeSlots(courses: Pick<TimedCourse, "startMinutes" | "endMinutes">[]) {
  const seen = new Map<string, { startMinutes: number; endMinutes: number; count: number }>();
  for (const c of courses) {
    const key = `${c.startMinutes}-${c.endMinutes}`;
    const slot = seen.get(key) ?? { startMinutes: c.startMinutes, endMinutes: c.endMinutes, count: 0 };
    slot.count++;
    seen.set(key, slot);
  }
  return [...seen.values()].sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
}
