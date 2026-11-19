import { LoaderCircle } from 'lucide-react';

export function LoadingState({
  label = 'Loading videos…',
  layout = 'spinner',
}: {
  label?: string;
  layout?: 'spinner' | 'grid';
}) {
  if (layout === 'grid') {
    return (
      <div role="status" aria-label={label} className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <span className="sr-only">{label}</span>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
            <div className="aspect-video rounded-card bg-surface-subtle" />
            <div className="mt-3 flex gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-surface-subtle" />
              <div className="min-w-0 flex-1 space-y-2 py-1">
                <div className="h-4 w-11/12 rounded bg-surface-subtle" />
                <div className="h-3 w-2/3 rounded bg-surface-subtle" />
                <div className="h-3 w-1/2 rounded bg-surface-subtle" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="status" className="flex items-center justify-center gap-3 py-20 text-text-muted">
      <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-brand-dark" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-card border border-border bg-surface-light p-6 text-center dark:bg-surface-dark">
      <h2 className="font-semibold">We couldn’t load this page</h2>
      <p className="mt-2 text-sm text-text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 rounded-control bg-brand-action px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-action-hover"
        >
          Try again
        </button>
      )}
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
