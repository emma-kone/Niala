"use client";

import ChatPanel from "./chat-panel";

/** Assistant global : discute avec toute la bibliothèque de l'étudiant (les conversations de document restent dans chaque cours). */
export default function AssistantView() {
  return (
    <div className="h-[calc(100dvh-4rem)] md:h-[calc(100dvh-4.75rem)]">
      <h1 className="sr-only">Assistant IA</h1>
      <ChatPanel scope="GLOBAL" variant="page" />
    </div>
  );
}
