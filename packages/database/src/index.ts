import { PrismaClient } from '@prisma/client';

// Prevent exhausting database connection pool during development reloads
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const db = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = db;
}

// Re-export all Prisma generated types so apps don't need direct prisma imports
export * from '@prisma/client';
