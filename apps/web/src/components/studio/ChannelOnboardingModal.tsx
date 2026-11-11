import React from 'react';

export const ChannelOnboardingModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark p-6 rounded-2xl shadow-xl">
        <h2 className="text-xl font-bold font-display mb-2">Create your Channel</h2>
        <p className="mb-6 text-sm text-text-muted">You need a channel to upload videos.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Channel Name</label>
            <input type="text" placeholder="e.g. My Awesome Channel" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Handle</label>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-control border border-r-0 border-border-light bg-surface-subtle px-3 text-text-muted dark:border-border-dark">@</span>
              <input type="text" placeholder="handle" className="flex-1 rounded-r-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Cancel</button>
            <button className="rounded-control bg-brand-action px-4 py-2 text-sm font-bold text-brand-foreground transition hover:bg-brand-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Create Channel</button>
          </div>
        </div>
      </div>
    </div>
  );
};
