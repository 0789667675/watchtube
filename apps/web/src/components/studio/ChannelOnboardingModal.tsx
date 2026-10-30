import React from 'react';

export const ChannelOnboardingModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark p-6 rounded-2xl shadow-xl">
        <h2 className="text-xl font-bold font-display mb-2">Create your Channel</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">You need a channel to upload videos.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Channel Name</label>
            <input type="text" placeholder="e.g. My Awesome Channel" className="w-full rounded-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Handle</label>
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border-light dark:border-border-dark bg-gray-100 dark:bg-gray-800 text-gray-500">@</span>
              <input type="text" placeholder="handle" className="flex-1 rounded-r-lg border border-border-light dark:border-border-dark bg-canvas-light dark:bg-canvas-obsidian px-4 py-2 focus:ring-brand-light focus:outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
            <button className="px-4 py-2 rounded-lg text-sm font-bold bg-brand-light dark:bg-brand-dark text-white hover:opacity-90">Create Channel</button>
          </div>
        </div>
      </div>
    </div>
  );
};
