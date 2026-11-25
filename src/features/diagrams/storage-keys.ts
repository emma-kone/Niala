// Clés de stockage local du laboratoire de diagrammes (module léger : importé aussi par la page d'accueil).

/** Dernier diagramme ouvert : en revenant au module, on y retourne directement. */
export const LAST_DIAGRAM_KEY = "niala:diagram:last";
/** État de l'écran d'un diagramme (cadrage, panneau, onglet, sélection, brouillon de propriétés). */
export const diagramUiKey = (id: string) => `niala:diagram-ui:${id}`;
/** Discussion avec l'assistant, gardée le temps de la session de l'onglet. */
export const diagramChatKey = (id: string) => `niala:diagram-chat:${id}`;
