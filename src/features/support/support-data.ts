"use client";

import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";

// Données du module Suggestions, partagées entre le module et le préchargement en arrière-plan (app-shell).

export interface MyRequest { id: string; reference: string; type: string; subject: string; status: string; createdAt: string; updatedAt: string; replies: number }
export interface RequestDetailData { id: string; reference: string; type: string; subject: string; description: string; module: string | null; status: string; createdAt: string; attachments: { index: number; name: string; size: number }[]; messages: { id: string; authorRole: "USER" | "ADMIN"; authorName: string | null; body: string; createdAt: string }[] }
export interface NotificationsData { items: { id: string; kind: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[]; unread: number }
export interface Reply { id: string; body: string; createdAt: string; requestId: string; reference: string; subject: string; status: string }

export const REQUESTS_KEY = ["support-requests"] as const;
export const NOTIFICATIONS_KEY = ["notifications"] as const;
export const REPLIES_KEY = ["support-replies"] as const;
export const requestKey = (id: string) => ["support-request", id] as const;

export const fetchRequests = () => api.get<{ requests: MyRequest[] }>("/api/support/requests").then((r) => r.requests);
export const fetchNotifications = () => api.get<NotificationsData>("/api/notifications");
export const fetchReplies = () => api.get<{ replies: Reply[] }>("/api/support/replies").then((r) => r.replies);
export const fetchRequest = (id: string) => api.get<{ request: RequestDetailData }>(`/api/support/requests/${id}`).then((r) => r.request);

/** Précharge ce qu'affiche le module Suggestions : il s'ouvre ensuite sans attendre le réseau. */
export function prefetchSuggestions(qc: QueryClient) {
  void qc.prefetchQuery({ queryKey: REQUESTS_KEY, queryFn: fetchRequests });
  void qc.prefetchQuery({ queryKey: REPLIES_KEY, queryFn: fetchReplies });
}
