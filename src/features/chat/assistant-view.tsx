"use client";

import ChatPanel from "./chat-panel";

/** Assistant global : discute avec toute la bibliothèque de l'étudiant (les conversations de document restent dans chaque cours). */
export default function AssistantView() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col px-4 py-4 md:h-[calc(100dvh-3.25rem)]">
      <header className="pb-3">
        <h1 className="typo-h2">Assistant IA</h1>
        <p className="typo-subtitle">Posez des questions sur vos cours : l'assistant cherche et lit vos documents, et cite ses sources.</p>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <ChatPanel scope="GLOBAL" />
      </div>
    </div>
  );
}
