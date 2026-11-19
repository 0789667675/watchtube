import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import { isStudioChannel, type StudioChannel } from '../../pages/studio/studioApi';

interface ChannelForm {
  name: string;
  handle: string;
}

export const ChannelOnboardingModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onCreated: (channel: StudioChannel) => void;
}> = ({ isOpen, onClose, onCreated }) => {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ChannelForm>();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const createChannel = async (data: ChannelForm) => {
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      const normalizedHandle = data.handle.trim().replace(/^@/, '');
      const response = await apiClient.post<unknown>('/api/v1/channels', {
        name: data.name.trim(),
        handle: `@${normalizedHandle}`,
      });
      if (!isStudioChannel(response.data)) {
        throw new Error('The server did not confirm the created channel.');
      }
      onCreated(response.data);
      reset();
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Channel creation failed. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface-light p-6 shadow-xl dark:bg-surface-dark"
      >
        <h2 id="create-channel-title" className="mb-2 text-xl font-bold font-display">Create your channel</h2>
        <p className="mb-6 text-sm text-text-muted">You need a channel to upload videos.</p>

        <form onSubmit={handleSubmit(createChannel)} className="space-y-4">
          <div>
            <label htmlFor="channel-name" className="mb-1 block text-sm font-medium">Channel name</label>
            <input id="channel-name" {...register('name', {
              required: 'Enter a channel name.',
              maxLength: { value: 80, message: 'Channel names must be 80 characters or fewer.' },
              validate: (value) => value.trim().length > 0 || 'Enter a channel name.',
            })} type="text" maxLength={80} autoComplete="organization" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'channel-name-error' : undefined} placeholder="e.g. My Awesome Channel" className="w-full rounded-control border border-border bg-canvas-light px-4 py-2 focus:outline-none focus:ring-2 focus:ring-focus dark:bg-canvas-obsidian" />
            {errors.name?.message && <p id="channel-name-error" role="alert" className="mt-1 text-sm text-status-warning">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="channel-handle" className="mb-1 block text-sm font-medium">Handle</label>
            <div className="flex">
              <span aria-hidden="true" className="inline-flex items-center rounded-l-control border border-r-0 border-border bg-surface-subtle px-3 text-text-muted">@</span>
              <input id="channel-handle" {...register('handle', {
                required: 'Enter a channel handle.',
                minLength: { value: 3, message: 'Handles must be at least 3 characters.' },
                maxLength: { value: 30, message: 'Handles must be 30 characters or fewer.' },
                pattern: { value: /^[a-zA-Z0-9_]+$/, message: 'Use letters, numbers, and underscores only.' },
              })} type="text" maxLength={30} autoComplete="off" aria-invalid={Boolean(errors.handle)} aria-describedby={errors.handle ? 'channel-handle-error' : undefined} placeholder="handle" className="min-w-0 flex-1 rounded-r-control border border-border bg-canvas-light px-4 py-2 focus:outline-none focus:ring-2 focus:ring-focus dark:bg-canvas-obsidian" />
            </div>
            {errors.handle?.message && <p id="channel-handle-error" role="alert" className="mt-1 text-sm text-status-warning">{errors.handle.message}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-status-warning">{error}</p>}
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-control px-4 py-2 text-sm font-medium transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="rounded-control bg-brand-action px-4 py-2 text-sm font-bold text-brand-foreground transition hover:bg-brand-action-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {isSubmitting ? 'Creating…' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
