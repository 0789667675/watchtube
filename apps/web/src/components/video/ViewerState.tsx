import { LoaderCircle } from 'lucide-react';

export function LoadingState({ label = 'Loading videos…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-20 text-text-muted">
      <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-brand-dark" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-card border border-border bg-surface-light p-6 text-center dark:bg-surface-dark">
      <h2 className="font-semibold">We couldn’t load this page</h2>
      <p className="mt-2 text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-xl py-20 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-text-muted">{message}</p>
    </div>
  );
}
