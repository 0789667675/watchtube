import { PrismaClient } from '@prisma/client';

if (!process.env.WATCHTUBE_DATABASE_URL && process.env.DATABASE_URL) {
  process.env.WATCHTUBE_DATABASE_URL = process.env.DATABASE_URL;
}

if (!process.env.WATCHTUBE_DIRECT_URL && process.env.DATABASE_URL_UNPOOLED) {
  process.env.WATCHTUBE_DIRECT_URL = process.env.DATABASE_URL_UNPOOLED;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

export * from '@prisma/client';
