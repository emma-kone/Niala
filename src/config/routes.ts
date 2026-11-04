export const routes = {
  home: "/",
  login: "/login",
  subjects: "/matieres",
  subject: (id: string) => `/matieres/${id}` as const,
  assistant: "/assistant",
  exercises: "/exercices",
  code: "/code",
  sql: "/sql",
  progress: "/progression",
  settings: "/reglages",
} as const;
