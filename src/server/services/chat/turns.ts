// Générations en cours, pour pouvoir en interrompre une à la demande de l'étudiant.
// Le registre vit dans le processus : si l'arrêt arrive sur une autre instance, stopTurn répond false et le client coupe son flux.

interface Turn {
  userId: string;
  controller: AbortController;
}

const store = globalThis as unknown as { nialaChatTurns?: Map<string, Turn> };
const turns = (store.nialaChatTurns ??= new Map<string, Turn>());

/** Déclare la génération d'une conversation ; `end` doit être appelé quand elle se termine, quelle qu'en soit l'issue. */
export function beginTurn(conversationId: string, userId: string) {
  const controller = new AbortController();
  const turn = { userId, controller };
  turns.set(conversationId, turn);
  return {
    signal: controller.signal,
    end: () => {
      if (turns.get(conversationId) === turn) turns.delete(conversationId);
    },
  };
}

/** Interrompt la génération en cours. Une conversation d'un autre utilisateur est traitée comme absente. */
export function stopTurn(conversationId: string, userId: string): boolean {
  const turn = turns.get(conversationId);
  if (!turn || turn.userId !== userId) return false;
  turn.controller.abort();
  return true;
}
