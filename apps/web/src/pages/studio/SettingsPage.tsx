import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useOutletContext } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import {
  ChannelImageUploadError,
  uploadChannelImage,
} from '../../api/channelImageUpload';
import {
  isStudioChannelImageConfirmation,
  isStudioChannelSettings,
  STUDIO_CHANNEL_IMAGE_MAX_FILE_SIZE,
} from './studioApi';
import type {
  StudioChannelImageConfirmation,
  StudioChannelImagePurpose,
  StudioOutletContext,
  StudioChannelSettings,
} from './studioApi';

interface ChannelSettingsForm {
  name: string;
  handle: string;
  description: string;
}

type SettingsLoadResult =
  | { channelId: string; status: 'loading' }
  | { channelId: string; status: 'ready'; channel: StudioChannelSettings }
  | { channelId: string; status: 'error'; message: string; unauthorized: boolean };

const emptyForm: ChannelSettingsForm = { name: '', handle: '', description: '' };
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ImageUploadPhase = 'idle' | 'selected' | 'requesting' | 'uploading' | 'confirming' | 'error';

interface ImageUploadState {
  file: File | null;
  phase: ImageUploadPhase;
  progress: number | null;
  error: string;
  uploadToken?: string;
}

function emptyImageUploadStates(): Record<StudioChannelImagePurpose, ImageUploadState> {
  return {
    avatar: { file: null, phase: 'idle', progress: null, error: '' },
    banner: { file: null, phase: 'idle', progress: null, error: '' },
  };
}

function isImageUploadBusy(state: ImageUploadState): boolean {
  return ['requesting', 'uploading', 'confirming'].includes(state.phase);
}

function toFormValues(channel: StudioChannelSettings): ChannelSettingsForm {
  return {
    name: channel.name,
    handle: channel.handle.replace(/^@/, ''),
    description: channel.description ?? '',
  };
}

function safeImageUrl(value: string | null): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function confirmChannelImage(
  channelId: string,
  purpose: StudioChannelImagePurpose,
  uploadToken: string,
): Promise<StudioChannelImageConfirmation> {
  const { data } = await apiClient.post<unknown>(
    `/api/v1/channels/${encodeURIComponent(channelId)}/images/${purpose}/confirm`,
    { uploadToken },
  );
  if (!isStudioChannelImageConfirmation(data, purpose) || data.channel.id !== channelId) {
    throw new Error('The server did not confirm the saved channel image.');
  }
  return data;
}

export function SettingsPage() {
  const { profile, updateChannel } = useOutletContext<StudioOutletContext>();
  const [selectedChannelId, setSelectedChannelId] = useState(profile.channels[0]?.id ?? '');
  const [attempt, setAttempt] = useState(0);
  const [loadResult, setLoadResult] = useState<SettingsLoadResult>({
    channelId: '',
    status: 'loading',
  });
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [imageUploads, setImageUploads] = useState<Record<StudioChannelImagePurpose, ImageUploadState>>(
    emptyImageUploadStates,
  );
  const [failedPreviewUrls, setFailedPreviewUrls] = useState<Set<string>>(() => new Set());
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ChannelSettingsForm>({ defaultValues: emptyForm });

  useEffect(() => {
    if (!selectedChannelId) return;

    const controller = new AbortController();
    apiClient.get<unknown>(
      `/api/v1/channels/${encodeURIComponent(selectedChannelId)}/settings`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!isStudioChannelSettings(data) || data.id !== selectedChannelId) {
          setLoadResult({
            channelId: selectedChannelId,
            status: 'error',
            message: 'The channel settings response could not be verified.',
            unauthorized: false,
          });
          return;
        }
        reset(toFormValues(data));
        setLoadResult({ channelId: selectedChannelId, status: 'ready', channel: data });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setLoadResult({
          channelId: selectedChannelId,
          status: 'error',
          message: getApiErrorMessage(requestError, 'Channel settings could not be loaded.'),
          unauthorized: axios.isAxiosError(requestError) && requestError.response?.status === 401,
        });
      });

    return () => controller.abort();
  }, [attempt, reset, selectedChannelId]);

  const currentResult: SettingsLoadResult = loadResult.channelId === selectedChannelId
    ? loadResult
    : { channelId: selectedChannelId, status: 'loading' };
  const imageUploadBusy = Object.values(imageUploads).some(isImageUploadBusy);
  const hasPendingImageSelection = Object.values(imageUploads).some(
    (state) => Boolean(state.file || state.uploadToken),
  );

  const updateImageUpload = (
    purpose: StudioChannelImagePurpose,
    update: (state: ImageUploadState) => ImageUploadState,
  ) => {
    setImageUploads((current) => ({ ...current, [purpose]: update(current[purpose]) }));
  };

  const saveConfirmedImage = (
    channelId: string,
    purpose: StudioChannelImagePurpose,
    confirmation: StudioChannelImageConfirmation,
  ) => {
    updateChannel(confirmation.channel);
    setLoadResult({ channelId, status: 'ready', channel: confirmation.channel });
    setSaveNotice(`${purpose === 'avatar' ? 'Avatar' : 'Banner'} saved.`);
    setSaveError('');
    updateImageUpload(purpose, () => emptyImageUploadStates()[purpose]);
  };

  const uploadSelectedImage = async (purpose: StudioChannelImagePurpose) => {
    const state = imageUploads[purpose];
    if (!state.file || !selectedChannelId) return;
    const file = state.file;
    const channelId = selectedChannelId;

    updateImageUpload(purpose, (current) => ({
      ...current,
      phase: 'requesting',
      progress: 0,
      error: '',
      uploadToken: undefined,
    }));
    try {
      const confirmation = await uploadChannelImage({
        requestIntent: async (metadata) => (
          await apiClient.post<unknown>(
            `/api/v1/channels/${encodeURIComponent(metadata.channelId)}/images/${metadata.purpose}/upload-intent`,
            { contentType: metadata.contentType, fileSize: metadata.fileSize },
          )
        ).data,
        upload: async (uploadUrl, selectedFile, onProgress) => {
          updateImageUpload(purpose, (current) => ({ ...current, phase: 'uploading' }));
          await axios.put(uploadUrl, selectedFile, {
            withCredentials: false,
            headers: { 'Content-Type': selectedFile.type },
            onUploadProgress: (event) => {
              if (event.total) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
            },
          });
        },
        confirm: async (targetChannelId, targetPurpose, uploadToken) => {
          updateImageUpload(purpose, (current) => ({ ...current, phase: 'confirming' }));
          return confirmChannelImage(targetChannelId, targetPurpose, uploadToken);
        },
      }, {
        channelId,
        purpose,
        contentType: file.type,
        fileSize: file.size,
      }, file, (progress) => {
        updateImageUpload(purpose, (current) => ({
          ...current,
          phase: current.phase === 'uploading' ? 'uploading' : 'confirming',
          progress,
        }));
      });
      saveConfirmedImage(channelId, purpose, confirmation);
    } catch (uploadError) {
      const workflowError = uploadError instanceof ChannelImageUploadError ? uploadError : null;
      const cause = workflowError?.originalError ?? uploadError;
      updateImageUpload(purpose, (current) => ({
        ...current,
        phase: 'error',
        error: getApiErrorMessage(cause, 'The image upload could not be completed.'),
        uploadToken: workflowError?.stage === 'confirmation'
          ? workflowError.intent?.uploadToken
          : undefined,
      }));
    }
  };

  const retryImageConfirmation = async (purpose: StudioChannelImagePurpose) => {
    const state = imageUploads[purpose];
    const channelId = selectedChannelId;
    if (!state.uploadToken || !channelId) return;
    updateImageUpload(purpose, (current) => ({
      ...current,
      phase: 'confirming',
      error: '',
    }));
    try {
      const confirmation = await confirmChannelImage(channelId, purpose, state.uploadToken);
      saveConfirmedImage(channelId, purpose, confirmation);
    } catch (requestError) {
      updateImageUpload(purpose, (current) => ({
        ...current,
        phase: 'error',
        error: getApiErrorMessage(requestError, 'The uploaded image could not be confirmed. Retry.'),
      }));
    }
  };

  const saveSettings = async (values: ChannelSettingsForm) => {
    const channelId = selectedChannelId;
    setSaveError('');
    setSaveNotice('');
    try {
      const { data } = await apiClient.patch<unknown>(
        `/api/v1/channels/${encodeURIComponent(channelId)}/settings`,
        {
          name: values.name.trim(),
          handle: values.handle.trim(),
          description: values.description.trim() || null,
        },
      );
      if (!isStudioChannelSettings(data) || data.id !== channelId) {
        throw new Error('The server did not confirm the requested channel settings.');
      }

      updateChannel(data);
      reset(toFormValues(data));
      setLoadResult({ channelId, status: 'ready', channel: data });
      setSaveNotice('Channel settings saved.');
    } catch (requestError) {
      setSaveError(getApiErrorMessage(requestError, 'Channel settings could not be saved.'));
    }
  };

  if (profile.channels.length === 0) {
    return (
      <section className="mx-auto max-w-3xl rounded-card border border-border bg-surface-light p-6 dark:bg-surface-dark sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Creator settings</h1>
        <p className="mt-2 text-sm text-text-muted">Create a channel before customizing a public profile.</p>
        <Link to="/studio/content" className="mt-5 inline-flex rounded-control bg-brand-action px-4 py-2 font-semibold text-brand-foreground hover:bg-brand-action-hover">
          Go to channel content
        </Link>
      </section>
    );
  }

  const selectedChannel = profile.channels.find((channel) => channel.id === selectedChannelId);

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Creator settings</h1>
          <p className="mt-1 text-sm text-text-muted">Manage saved channel details and review account identity.</p>
        </div>
        {profile.channels.length > 1 && (
          <label className="flex items-center gap-2 text-sm font-medium">
            Active channel
            <select
              value={selectedChannelId}
              disabled={isSubmitting || imageUploadBusy}
              onChange={(event) => {
                const nextChannelId = event.target.value;
                if (
                  (isDirty || hasPendingImageSelection)
                  && !window.confirm('Discard unsaved channel changes and selected image uploads?')
                ) {
                  event.currentTarget.value = selectedChannelId;
                  return;
                }
                setSelectedChannelId(nextChannelId);
                reset(emptyForm);
                setImageUploads(emptyImageUploadStates());
                setSaveError('');
                setSaveNotice('');
              }}
              className="max-w-56 rounded-control border border-border bg-surface-light px-3 py-2 dark:bg-surface-dark"
            >
              {profile.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section aria-labelledby="account-settings-title" className="rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark sm:p-6">
        <h2 id="account-settings-title" className="text-lg font-semibold">Account settings</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-text-muted">Signed-in email</dt>
            <dd className="mt-1 break-all font-medium">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-text-muted">Owned channels</dt>
            <dd className="mt-1 font-medium">{profile.channels.length}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-text-muted">
          Email, password, and account-security changes are not available through the current authentication API.
        </p>
      </section>

      <section aria-labelledby="channel-settings-title" className="rounded-card border border-border bg-surface-light p-5 dark:bg-surface-dark sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="channel-settings-title" className="text-lg font-semibold">Channel customization</h2>
            <p className="mt-1 text-sm text-text-muted">
              {selectedChannel ? `Public details for ${selectedChannel.name}.` : 'Loading the selected channel.'}
            </p>
          </div>
          {currentResult.status === 'ready' && (
            <Link
              to={`/channel/${encodeURIComponent(currentResult.channel.handle)}`}
              className="text-sm font-semibold text-brand-dark hover:underline"
            >
              View public channel
            </Link>
          )}
        </div>

        {currentResult.status === 'loading' ? (
          <p role="status" className="mt-5 text-sm text-text-muted">Loading saved channel settings…</p>
        ) : currentResult.status === 'error' ? (
          <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-subtle p-4">
            <p className="text-sm text-text-muted">{currentResult.message}</p>
            {currentResult.unauthorized ? (
              <Link to="/auth/login" className="text-sm font-semibold text-brand-dark hover:underline">Sign in again</Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLoadResult({ channelId: selectedChannelId, status: 'loading' });
                  setAttempt((current) => current + 1);
                }}
                className="rounded-control bg-surface-light px-4 py-2 text-sm font-semibold hover:bg-surface-hover dark:bg-surface-dark"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            {saveNotice && <p role="status" className="mt-5 rounded-control border border-border p-3 text-sm">{saveNotice}</p>}
            {saveError && <p role="alert" className="mt-5 rounded-control border border-border p-3 text-sm text-status-warning">{saveError}</p>}

            <form onSubmit={handleSubmit(saveSettings)} className="mt-5 space-y-5">
              <div>
                <label htmlFor="channel-name" className="block text-sm font-medium">Channel name</label>
                <input
                  id="channel-name"
                  {...register('name', {
                    required: 'Enter a channel name.',
                    maxLength: { value: 80, message: 'Channel names must be 80 characters or fewer.' },
                    validate: (value) => value.trim().length > 0 || 'Enter a channel name.',
                  })}
                  maxLength={80}
                  disabled={isSubmitting}
                  className="mt-1 w-full rounded-control border border-border bg-canvas-light px-4 py-2 focus:outline-none focus:ring-2 focus:ring-focus dark:bg-canvas-obsidian"
                />
                {errors.name?.message && <p role="alert" className="mt-1 text-sm text-status-warning">{errors.name.message}</p>}
              </div>

              <div>
                <label htmlFor="channel-handle" className="block text-sm font-medium">Channel handle</label>
                <div className="mt-1 flex">
                  <span aria-hidden="true" className="inline-flex items-center rounded-l-control border border-r-0 border-border bg-surface-subtle px-3 text-text-muted">@</span>
                  <input
                    id="channel-handle"
                    {...register('handle', {
                      required: 'Enter a channel handle.',
                      maxLength: { value: 30, message: 'Handles must be 30 characters or fewer.' },
                      pattern: {
                        value: /^[a-zA-Z0-9_]+$/,
                        message: 'Use letters, numbers, and underscores only.',
                      },
                    })}
                    maxLength={30}
                    autoComplete="off"
                    disabled={isSubmitting}
                    className="min-w-0 flex-1 rounded-r-control border border-border bg-canvas-light px-4 py-2 focus:outline-none focus:ring-2 focus:ring-focus dark:bg-canvas-obsidian"
                  />
                </div>
                {errors.handle?.message && <p role="alert" className="mt-1 text-sm text-status-warning">{errors.handle.message}</p>}
              </div>

              <div>
                <label htmlFor="channel-description" className="block text-sm font-medium">Description</label>
                <textarea
                  id="channel-description"
                  {...register('description', {
                    maxLength: { value: 1000, message: 'Descriptions must be 1,000 characters or fewer.' },
                  })}
                  maxLength={1000}
                  rows={5}
                  disabled={isSubmitting}
                  className="mt-1 w-full resize-y rounded-control border border-border bg-canvas-light px-4 py-2 focus:outline-none focus:ring-2 focus:ring-focus dark:bg-canvas-obsidian"
                />
                {errors.description?.message && <p role="alert" className="mt-1 text-sm text-status-warning">{errors.description.message}</p>}
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-divider pt-4">
                <button
                  type="button"
                  onClick={() => {
                    reset(toFormValues(currentResult.channel));
                    setSaveError('');
                    setSaveNotice('');
                  }}
                  disabled={!isDirty || isSubmitting}
                  className="rounded-control border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isDirty || isSubmitting || imageUploadBusy}
                  className="rounded-control bg-brand-action px-5 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>

            <section aria-labelledby="channel-images-title" className="mt-6 border-t border-divider pt-5">
              <h3 id="channel-images-title" className="font-semibold">Channel images</h3>
              <p className="mt-1 text-sm text-text-muted">
                Upload JPEG, PNG, or WebP images. Files are verified and normalized before they are saved to this channel.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {([
                  {
                    purpose: 'avatar',
                    label: 'Avatar',
                    savedUrl: currentResult.channel.avatarUrl,
                    instructions: 'Square crop, minimum 64 × 64 pixels; maximum 5 MB.',
                    className: 'h-20 w-20 rounded-full',
                  },
                  {
                    purpose: 'banner',
                    label: 'Banner',
                    savedUrl: currentResult.channel.bannerUrl,
                    instructions: 'Wide image, minimum 960 × 240 pixels; maximum 10 MB.',
                    className: 'aspect-[3/1] w-full',
                  },
                ] as const).map(({ purpose, label, savedUrl, instructions, className }) => {
                  const state = imageUploads[purpose];
                  const previewUrl = safeImageUrl(savedUrl);
                  const previewFailed = Boolean(previewUrl && failedPreviewUrls.has(previewUrl));
                  const busy = isImageUploadBusy(state);
                  const canRetryConfirmation = Boolean(state.uploadToken);

                  return (
                    <div key={purpose} className="min-w-0 rounded-control border border-border p-4">
                      <h4 className="font-medium">{label}</h4>
                      <p className="mt-1 text-sm text-text-muted">{instructions}</p>
                      <div className="mt-3 min-h-20">
                        {previewUrl && !previewFailed ? (
                          <img
                            src={previewUrl}
                            alt={`${currentResult.channel.name} ${label.toLowerCase()}`}
                            onError={() => setFailedPreviewUrls((current) => new Set(current).add(previewUrl))}
                            className={`${className} border border-border object-cover`}
                          />
                        ) : savedUrl ? (
                          <p className="text-sm text-text-muted">
                            {previewFailed
                              ? `The saved ${label.toLowerCase()} could not be loaded.`
                              : `The saved ${label.toLowerCase()} reference is not a valid HTTPS image URL.`}
                          </p>
                        ) : (
                          <p className="text-sm text-text-muted">No {label.toLowerCase()} is saved.</p>
                        )}
                      </div>
                      <label className="mt-4 block text-sm font-medium" htmlFor={`${purpose}-image-file`}>
                        Choose {label.toLowerCase()} image
                      </label>
                      <input
                        id={`${purpose}-image-file`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={isSubmitting || imageUploadBusy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          event.currentTarget.value = '';
                          if (!file) return;
                          const maxSize = STUDIO_CHANNEL_IMAGE_MAX_FILE_SIZE[purpose];
                          const error = !allowedImageTypes.has(file.type)
                            ? 'Choose a JPEG, PNG, or WebP image.'
                            : file.size <= 0 || file.size > maxSize
                              ? `Choose an image no larger than ${purpose === 'avatar' ? '5' : '10'} MB.`
                              : '';
                          updateImageUpload(purpose, () => ({
                            file: error ? null : file,
                            phase: error ? 'error' : 'selected',
                            progress: null,
                            error,
                          }));
                        }}
                        className="mt-1 block w-full text-sm file:mr-3 file:rounded-control file:border-0 file:bg-surface-subtle file:px-3 file:py-2 file:font-semibold hover:file:bg-surface-hover"
                      />
                      {state.file && <p className="mt-2 break-all text-sm text-text-muted">{state.file.name}</p>}
                      {state.error && <p role="alert" className="mt-2 text-sm text-status-warning">{state.error}</p>}
                      {busy && (
                        <div className="mt-3">
                          <p role="status" className="text-sm text-text-muted">
                            {state.phase === 'requesting'
                              ? 'Preparing secure upload…'
                              : state.phase === 'uploading'
                                ? state.progress === null ? 'Uploading image…' : `Uploading image: ${state.progress}%`
                                : 'Verifying and saving image…'}
                          </p>
                          {state.phase === 'uploading' && (
                            <progress
                              aria-label={`${label} upload progress`}
                              max={100}
                              value={state.progress ?? undefined}
                              className="mt-2 w-full accent-brand-action"
                            />
                          )}
                        </div>
                      )}
                      {state.file && (
                        <button
                          type="button"
                          onClick={() => canRetryConfirmation
                            ? retryImageConfirmation(purpose)
                            : uploadSelectedImage(purpose)}
                          disabled={isSubmitting || imageUploadBusy}
                          className="mt-3 rounded-control bg-brand-action px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-action-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {canRetryConfirmation
                            ? 'Retry confirmation'
                            : state.phase === 'error'
                              ? 'Retry upload'
                              : `Upload ${label.toLowerCase()}`}
                        </button>
                      )}
                      {canRetryConfirmation && (
                        <button
                          type="button"
                          onClick={() => uploadSelectedImage(purpose)}
                          disabled={isSubmitting || imageUploadBusy || !state.file}
                          className="ml-3 mt-3 rounded-control border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Upload again
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </section>
    </section>
  );
}
