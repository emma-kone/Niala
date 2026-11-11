import { describe, expect, it } from "vitest";
import { MAX_CONVERSATIONS, MAX_MESSAGES, NEW_TITLE, parseConversations, pruneConversations, titleOf } from "./assistant-history";

const msg = (role: string, content: string) => ({ role, content });
const conv = (id: string, updatedAt: number, n = 1) => ({ id, title: id, updatedAt, messages: Array.from({ length: n }, (_, i) => msg("user", `m${i}`)) });

describe("historique de l'assistant IA", () => {
  it("titre = première question, raccourcie ; « Nouvelle conversation » sans question", () => {
    expect(titleOf([])).toBe(NEW_TITLE);
    expect(titleOf([msg("assistant", "Bonjour"), msg("user", "  Résume   l'activité  ")])).toBe("Résume l'activité");
    expect(titleOf([msg("user", "x".repeat(200))]).length).toBe(60);
  });

  it("relit un historique valide et ignore tout ce qui est illisible ou vide", () => {
    expect(parseConversations(null)).toEqual([]);
    expect(parseConversations("pas du json")).toEqual([]);
    expect(parseConversations('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([conv("a", 5), { id: "b", messages: [] }, { nope: true }, { id: "c", updatedAt: 1, messages: [msg("user", "salut"), { role: 3 }] }]);
    const out = parseConversations(raw);
    expect(out.map((c) => c.id)).toEqual(["a", "c"]);
    expect(out[1].messages).toHaveLength(1);
    expect(out[1].title).toBe("salut");
  });

  it("conserve les plus récentes, sans brouillon vide, avec des plafonds", () => {
    const many = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, i) => conv(`c${i}`, i));
    const kept = pruneConversations([...many, conv("vide", 999, 0)]);
    expect(kept).toHaveLength(MAX_CONVERSATIONS);
    expect(kept[0].id).toBe(`c${MAX_CONVERSATIONS + 4}`);
    expect(kept.some((c) => c.id === "vide")).toBe(false);
    expect(pruneConversations([conv("long", 1, MAX_MESSAGES + 20)])[0].messages).toHaveLength(MAX_MESSAGES);
  });
});
