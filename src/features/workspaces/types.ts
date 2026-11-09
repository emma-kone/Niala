/** Contrat commun des composants d'environnement : la production est un document JSON validé côté serveur. */
export interface WorkspaceProps {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  payload: Record<string, unknown>;
}
