export const routes = {
  home: "/",
  login: "/login",
  subjects: "/matieres",
  subject: (id: string) => `/matieres/${id}` as const,
  generate: "/generer",
  session: (id: string) => `/sessions/${id}` as const,
  code: "/code",
  sql: "/sql",
  progress: "/progression",
  settings: "/reglages",
} as const;
