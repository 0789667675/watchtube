# WatchTube Monorepo Architecture & Guidelines

## Architecture Breakdown
- **Turborepo** + **pnpm workspaces** for monorepo management.
- `apps/web`: Vite + React 18+ application (TypeScript, Tailwind CSS, TanStack Query).
- `apps/api`: Node.js Express server (TypeScript, Zod, Helmet).
- `packages/database`: Prisma schema and PostgreSQL configuration.
- `packages/types`: Shared TypeScript interfaces and DTOs.
- `packages/config`: Shared ESLint, Prettier, and TypeScript configurations.

## Command Reference
- `pnpm install`: Install dependencies across all workspaces.
- `pnpm build`: Build all apps and packages using Turbo.
- `pnpm dev`: Start all apps in development mode.
- `pnpm lint`: Run linting across the monorepo.
- `pnpm test`: Run tests across the monorepo.

## Coding Standards
- **Strict TypeScript**: All apps and packages must have `strict: true` in their `tsconfig.json`.
- **Validation**: Zod validation must be used on all API boundaries (requests and responses).
- **Styling**: No inline styles in `apps/web`. Use Tailwind CSS utility classes exclusively.

## Cloudflare R2 Integration Guidelines
- Implement zero-egress storage patterns.
- Use presigned URLs (`@aws-sdk/s3-request-presigner`) for client uploads and downloads.
- Direct object reads should be cached via Cloudflare CDN to avoid egress costs.
