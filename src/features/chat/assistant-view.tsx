"use client";

import ChatPanel from "./chat-panel";

/** Assistant global : discute avec toute la bibliothèque de l'étudiant (les conversations de document restent dans chaque cours). */
export default function AssistantView() {
  return (
    <div className="h-[calc(100dvh-3.25rem)] lg:h-[calc(100dvh-1.5rem)]">
      <h1 className="sr-only">Assistant IA</h1>
      <ChatPanel scope="GLOBAL" variant="page" />
    </div>
  );
}
