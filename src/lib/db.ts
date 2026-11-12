import { PrismaClient } from '@prisma/client'
import { softDeleteExtension } from '@/lib/soft-delete'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Client brut : voit TOUT, y compris les contenus supprimés par les étudiants (suppression douce).
 * Réservé aux statistiques et analyses de l'administration.
 */
export const dbAll =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(process.env.PRISMA_LOG_QUERIES ? { log: ['query' as const] } : {}),
    // Transactions interactives : le délai par défaut de Prisma (5 s, 2 s d'attente d'une connexion) est trop court dès que
    // la base répond lentement ; la transaction était alors fermée en cours de route (erreur P2028, réponse 500).
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  })

// Always assign to globalForPrisma so that the singleton is preserved across
// hot-reloads in dev AND across Vercel/Edge cold-start module re-evaluations
// in production. Without this, a second PrismaClient instance can be created
// before the first one has connected, causing "table does not exist" 500 errors.
globalForPrisma.prisma = dbAll

/**
 * Client de l'application : les contenus supprimés par les étudiants y sont invisibles, et leur suppression
 * définitive est refusée (voir src/lib/soft-delete.ts). Même connexion que `dbAll`.
 */
export const db = dbAll.$extends(softDeleteExtension)

/** Transaction du client de l'application (`db.$transaction(async (tx) => …)`). */
export type DbTx = Parameters<Parameters<typeof db.$transaction>[0]>[0]
