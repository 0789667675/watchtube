import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import {
  MAX_VIDEO_UPLOAD_SIZE,
  normalizeUploadTitle,
  retryUploadVerification,
  retryVideoUpload,
  startVideoUpload,
  UploadWorkflowError,
  validateUploadFile,
  validateUploadTitle,
  type UploadWorkflowDependencies,
} from '../../api/videoUploadWorkflow';

const categories = [
  'FILM_ANIMATION', 'AUTOS_VEHICLES', 'MUSIC', 'PETS_ANIMALS', 'SPORTS',
  'TRAVEL_EVENTS', 'GAMING', 'PEOPLE_BLOGS', 'COMEDY', 'ENTERTAINMENT',
  'NEWS_POLITICS', 'HOWTO_STYLE', 'EDUCATION', 'SCIENCE_TECH',
  'NONPROFITS_ACTIVISM', 'OTHER',
] as const;

interface UploadModalProps {
  isOpen: boolean;
  channelId: string;
  initialVideoId?: string | null;
  onClose: () => void;
  onUploaded: () => void;
}

interface UploadForm {
  title: string;
  description: string;
  tags: string;
  category: typeof categories[number];
  language: string;
  madeForKids: boolean;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  copyrightDeclared: boolean;
}

type VideoStatus =
  | 'DRAFT'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'PUBLISHED'
  | 'FAILED'
  | 'BLOCKED'
  | 'REJECTED'
  | 'READY';

type UploadPhase =
  | 'ready'
  | 'saving'
  | 'requesting'
  | 'uploading'
  | 'verifying'
  | 'processing'
  | 'ready-to-publish'
  | 'published'
  | 'upload-error'
  | 'verify-error'
  | 'request-error';

interface VideoDetails {
  videoId: string;
  title: string;
  description: string | null;
  tags: string[];
  category: typeof categories[number];
  language: string;
  madeForKids: boolean;
  visibility: UploadForm['visibility'];
  copyrightDeclared: boolean;
  copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED';
  status: VideoStatus;
  thumbnailUrl: string | null;
}

const defaultValues: UploadForm = {
  title: '',
  description: '',
  tags: '',
  category: 'OTHER',
  language: 'en',
  madeForKids: false,
  visibility: 'PRIVATE',
  copyrightDeclared: false,
};

function getMetadata(values: UploadForm) {
  return {
    title: normalizeUploadTitle(values.title),
    description: values.description.trim() || null,
    tags: [...new Set(values.tags.split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean))],
    category: values.category,
    language: values.language.trim(),
    madeForKids: values.madeForKids,
    visibility: values.visibility,
    copyrightDeclared: values.copyrightDeclared,
  };
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  channelId,
  initialVideoId = null,
  onClose,
  onUploaded,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('ready');
  const [videoId, setVideoId] = useState<string | null>(initialVideoId);
  const [videoStatus, setVideoStatus] = useState<VideoStatus>('DRAFT');
  const [copyrightReviewStatus, setCopyrightReviewStatus] = useState<'NOT_SCANNED' | 'BLOCKED'>('NOT_SCANNED');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [uploadAttempts, setUploadAttempts] = useState(0);
  const uploadController = useRef<AbortController | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { errors },
  } = useForm<UploadForm>({ defaultValues });
  const titleValue = watch('title') ?? '';
  const tagValue = watch('tags') ?? '';
  const copyrightDeclaredValue = watch('copyrightDeclared');
  const isBusy = ['saving', 'requesting', 'uploading', 'verifying'].includes(phase);

  useEffect(() => {
    if (!thumbnailFile) {
      setThumbnailPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(thumbnailFile);
    setThumbnailPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnailFile]);

  useEffect(() => {
    if (!file) {
      setVideoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    if (!initialVideoId) {
      setVideoId(null);
      setVideoStatus('DRAFT');
      setThumbnailUrl(null);
      setThumbnailFile(null);
      setCopyrightReviewStatus('NOT_SCANNED');
      setPhase('ready');
      setError('');
      reset(defaultValues);
      return;
    }

    apiClient.get<VideoDetails>(`/api/v1/videos/${initialVideoId}`)
      .then(({ data }) => {
        if (!active) return;
        setVideoId(data.videoId);
        setVideoStatus(data.status);
        setThumbnailUrl(data.thumbnailUrl);
        setCopyrightReviewStatus(data.copyrightReviewStatus);
        setPhase(data.status === 'PROCESSING' ? 'processing'
          : data.status === 'READY_FOR_REVIEW' ? 'ready-to-publish'
            : data.status === 'PUBLISHED' ? 'published' : 'ready');
        reset({
          title: data.title,
          description: data.description ?? '',
          tags: data.tags.join(', '),
          category: data.category,
          language: data.language,
          madeForKids: data.madeForKids,
          visibility: data.visibility,
          copyrightDeclared: data.copyrightDeclared,
        });
      })
      .catch((requestError: unknown) => {
        if (active) setError(getApiErrorMessage(requestError, 'Video details could not be loaded.'));
      });
    return () => { active = false; };
  }, [initialVideoId, isOpen, reset]);

  const uploadThumbnail = useCallback(async (id: string, selectedFile: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP thumbnail.');
    }
    if (selectedFile.size <= 0 || selectedFile.size > 5 * 1024 * 1024) {
      throw new Error('Choose a thumbnail no larger than 5 MB.');
    }
    const metadata = { contentType: selectedFile.type, fileSize: selectedFile.size };
    const target = await apiClient.post<{ uploadUrl: string }>(
      `/api/v1/videos/${id}/thumbnail-upload-intent`,
      metadata,
    );
    await axios.put(target.data.uploadUrl, selectedFile, {
      withCredentials: false,
      headers: { 'Content-Type': selectedFile.type },
    });
    await apiClient.post(`/api/v1/videos/${id}/thumbnail-confirmation`, metadata);
    setThumbnailFile(null);
  }, []);

  const saveMetadata = useCallback(async (values: UploadForm): Promise<string> => {
    if (!channelId) throw new Error('Select a channel before saving the video.');
    const titleError = validateUploadTitle(values.title);
    if (titleError) throw new Error(titleError);
    const metadata = getMetadata(values);
    if (metadata.tags.length > 20 || metadata.tags.some((tag) => tag.length > 50)) {
      throw new Error('Use up to 20 tags, with no tag longer than 50 characters.');
    }
    if (metadata.language.length < 2 || metadata.language.length > 35) {
      throw new Error('Enter a language code or name between 2 and 35 characters.');
    }

    let id = videoId;
    if (id) {
      await apiClient.patch(`/api/v1/videos/${id}`, metadata);
    } else {
      const { data } = await apiClient.post<{ videoId: string; status: VideoStatus }>(
        '/api/v1/videos/drafts',
        { channelId, ...metadata },
      );
      id = data.videoId;
      setVideoId(id);
      setVideoStatus(data.status);
    }
    if (thumbnailFile && id) await uploadThumbnail(id, thumbnailFile);
    onUploaded();
    return id;
  }, [channelId, onUploaded, thumbnailFile, uploadThumbnail, videoId]);

  const workflowDependencies: UploadWorkflowDependencies = useMemo(() => ({
    requestIntent: async (metadata) => {
      const id = await saveMetadata(getValues());
      if (videoStatus === 'UPLOADING') {
        const renewed = await apiClient.post<{ uploadUrl: string }>(
          `/api/v1/videos/${id}/upload-url`,
          { contentType: metadata.contentType, fileSize: metadata.fileSize },
        );
        return { videoId: id, uploadUrl: renewed.data.uploadUrl };
      }
      return (await apiClient.post('/api/v1/videos/upload-intent', {
        videoId: id,
        contentType: metadata.contentType,
        fileSize: metadata.fileSize,
      })).data;
    },
    refreshUploadUrl: async (id, metadata) => (
      await apiClient.post<{ uploadUrl: string }>(`/api/v1/videos/${id}/upload-url`, metadata)
    ).data.uploadUrl,
    upload: async (url, selectedFile, onProgress) => {
      setPhase('uploading');
      setProgress(0);
      const controller = new AbortController();
      uploadController.current = controller;
      try {
        await axios.put(url, selectedFile, {
          withCredentials: false,
          signal: controller.signal,
          headers: { 'Content-Type': selectedFile.type },
          onUploadProgress: (event) => {
            if (event.total) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          },
        });
        onProgress(100);
      } finally {
        uploadController.current = null;
      }
    },
    verify: async (id) => {
      setPhase('verifying');
      await apiClient.post(`/api/v1/videos/${id}/verify-upload`);
    },
  }), [getValues, saveMetadata, videoStatus]);

  const beginUpload = async () => {
    if (!file) {
      setError('Select a video file before uploading.');
      return;
    }
    const fileError = validateUploadFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    setError('');
    setPhase('requesting');
    setUploadAttempts((attempt) => attempt + 1);
    try {
      if (videoId && videoStatus === 'UPLOADING') {
        const id = await saveMetadata(getValues());
        await retryVideoUpload(
          workflowDependencies,
          id,
          { contentType: file.type, fileSize: file.size },
          file,
          setProgress,
        );
      } else {
        await startVideoUpload(
          workflowDependencies,
          { title: getMetadata(getValues()).title, contentType: file.type, fileSize: file.size, channelId },
          file,
          (id) => {
            setVideoId(id);
            setVideoStatus('UPLOADING');
          },
          setProgress,
        );
      }
      setVideoStatus('PROCESSING');
      setPhase('processing');
      onUploaded();
    } catch (uploadError) {
      if (uploadError instanceof UploadWorkflowError && uploadError.videoId) {
        setVideoId(uploadError.videoId);
        setVideoStatus((current) => current === 'DRAFT' ? 'UPLOADING' : current);
      }
      const stage = uploadError instanceof UploadWorkflowError ? uploadError.stage : 'intent';
      const cause = uploadError instanceof UploadWorkflowError ? uploadError.originalError : uploadError;
      const fallback = axios.isCancel(cause)
        ? 'Upload cancelled. Your draft is saved; retry the upload when ready.'
        : stage === 'upload'
          ? 'Upload failed or the upload link expired. Retry to get a fresh link.'
          : stage === 'verification'
            ? 'The upload could not be verified. Retry verification.'
            : 'Could not start the upload. Please try again.';
      setError(getApiErrorMessage(cause, fallback));
      setPhase(stage === 'upload' ? 'upload-error' : stage === 'verification' ? 'verify-error' : 'request-error');
    }
  };

  const retryVerification = async () => {
    if (!videoId) return;
    setError('');
    setPhase('verifying');
    try {
      await retryUploadVerification(workflowDependencies, videoId);
      setVideoStatus('PROCESSING');
      setPhase('processing');
      onUploaded();
    } catch (verifyError) {
      const cause = verifyError instanceof UploadWorkflowError ? verifyError.originalError : verifyError;
      setError(getApiErrorMessage(cause, 'Verification is temporarily unavailable. Retry again.'));
      setPhase('verify-error');
    }
  };

  const refreshStatus = useCallback(async (id: string): Promise<VideoStatus> => {
    const { data } = await apiClient.get<{
      status: VideoStatus;
      thumbnailUrl: string | null;
      copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED';
    }>(`/api/v1/videos/${id}/upload-status`);
    setVideoStatus(data.status);
    setThumbnailUrl(data.thumbnailUrl);
    setCopyrightReviewStatus(data.copyrightReviewStatus);
    if (data.status === 'READY_FOR_REVIEW') {
      setPhase('ready-to-publish');
      onUploaded();
    } else if (data.status === 'PUBLISHED') {
      setPhase('published');
      onUploaded();
    } else if (data.status === 'FAILED' || data.status === 'REJECTED' || data.status === 'BLOCKED') {
      setError(data.status === 'BLOCKED'
        ? 'Publication is blocked by a verified copyright claim.'
        : 'Processing failed. The video was not published.');
      setPhase('ready');
      onUploaded();
    }
    return data.status;
  }, [onUploaded]);

  useEffect(() => {
    if (phase !== 'processing' || !videoId) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await refreshStatus(videoId);
        if (['READY_FOR_REVIEW', 'PUBLISHED', 'FAILED', 'REJECTED', 'BLOCKED'].includes(status)) {
          active = false;
          return;
        }
      } catch {
        if (active) setError('Could not refresh processing status. The server status is unchanged.');
      }
      if (active) timeout = setTimeout(poll, 2000);
    };
    timeout = setTimeout(poll, 1500);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [phase, refreshStatus, videoId]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    const selectedFile = acceptedFiles[0];
    setFile(selectedFile);
    setProgress(0);
    setError('');
    if (!getValues('title').trim() && !videoId) {
      const title = selectedFile.name.replace(/\.[^/.]+$/, '').trim();
      reset({ ...getValues(), title: title || 'Untitled video' });
    }
  }, [getValues, reset, videoId]);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: {
      'video/mp4': ['.mp4'],
      'video/webm': ['.webm'],
      'video/quicktime': ['.mov'],
    },
    maxSize: MAX_VIDEO_UPLOAD_SIZE,
    multiple: false,
    disabled: isBusy,
  });

  const saveDraft = async (values: UploadForm) => {
    setError('');
    setPhase('saving');
    try {
      await saveMetadata(values);
      setPhase(videoStatus === 'READY_FOR_REVIEW' ? 'ready-to-publish'
        : videoStatus === 'PUBLISHED' ? 'published' : 'ready');
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Video metadata could not be saved.'));
      setPhase('request-error');
    }
  };

  const publishVideo = async () => {
    if (!videoId) return;
    setError('');
    setPhase('saving');
    try {
      await saveMetadata(getValues());
      const { data } = await apiClient.post<{ status: VideoStatus; copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED' }>(
        `/api/v1/videos/${videoId}/publish`,
      );
      setVideoStatus(data.status);
      setCopyrightReviewStatus(data.copyrightReviewStatus);
      setPhase('published');
      onUploaded();
    } catch (publishError) {
      setError(getApiErrorMessage(publishError, 'The video could not be published. Review the error and retry.'));
      setPhase('ready-to-publish');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        className="flex max-h-[95vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-surface-light shadow-xl dark:bg-surface-dark"
      >
        <div className="flex items-center justify-between border-b border-border-light p-4 dark:border-border-dark">
          <div>
            <h2 id="upload-dialog-title" className="text-xl font-bold font-display">
              {initialVideoId ? 'Edit video' : 'Upload video'}
            </h2>
            {videoId && <p className="mt-1 text-xs text-text-muted">Status: {videoStatus.replaceAll('_', ' ')}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={isBusy} aria-label="Close upload dialog" className="rounded-full p-1 transition hover:bg-surface-hover disabled:opacity-50">
            <X className="h-6 w-6" />
          </button>
        </div>

        <form id="upload-form" onSubmit={handleSubmit(saveDraft)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
            <div {...getRootProps()} className={`cursor-pointer rounded-card border-2 border-dashed p-6 text-center transition sm:p-9 ${isDragActive ? 'border-brand-primary bg-brand-primary/10' : 'border-border hover:border-brand-primary'}`}>
              <input {...getInputProps()} />
              <UploadCloud className="mx-auto mb-3 h-12 w-12 text-text-muted" />
              <p className="font-medium">{file ? 'Choose a different video' : 'Select or drop a video file'}</p>
              <p className="mt-1 text-sm text-text-muted">MP4, WebM, or QuickTime, up to 2 GB.</p>
            </div>
            {fileRejections.length > 0 && (
              <div role="alert" className="rounded-control bg-surface-subtle p-3 text-sm text-status-warning">
                {fileRejections.map(({ file: rejectedFile, errors: rejectionErrors }) => (
                  <p key={`${rejectedFile.name}-${rejectedFile.size}`}>
                    {rejectedFile.name}: {rejectionErrors.map((item) => item.message).join(' ')}
                  </p>
                ))}
              </div>
            )}

            {file && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium">Video preview</p>
                  <video src={videoPreviewUrl ?? undefined} controls muted preload="metadata" className="aspect-video w-full rounded-card bg-black" />
                  <p className="mt-1 truncate text-xs text-text-muted">{file.name}</p>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Thumbnail preview</p>
                  {thumbnailPreviewUrl || thumbnailUrl
                    ? <img src={thumbnailPreviewUrl || thumbnailUrl || undefined} alt="Selected video thumbnail" className="aspect-video w-full rounded-card bg-surface-subtle object-cover" />
                    : <div className="flex aspect-video items-center justify-center rounded-card bg-surface-subtle p-4 text-center text-xs text-text-muted">A thumbnail will be generated after processing, or choose a custom image.</div>}
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium sm:col-span-2">
                Title
                <input
                  {...register('title', {
                    required: 'Enter a video title.',
                    maxLength: { value: 255, message: 'Video titles must be 255 characters or fewer.' },
                    validate: (value) => validateUploadTitle(value) ?? true,
                  })}
                  maxLength={255}
                  aria-invalid={Boolean(errors.title)}
                  className="mt-1 w-full rounded-lg border border-border-light bg-canvas-light px-4 py-2 dark:border-border-dark dark:bg-canvas-obsidian"
                />
                <span className="mt-1 block text-right text-xs text-text-muted">{titleValue.length}/255</span>
                {errors.title?.message && <span role="alert" className="text-sm text-status-warning">{errors.title.message}</span>}
              </label>

              <label className="block text-sm font-medium sm:col-span-2">
                Description
                <textarea
                  {...register('description', { maxLength: 5000 })}
                  rows={4}
                  maxLength={5000}
                  className="mt-1 w-full rounded-lg border border-border-light bg-canvas-light px-4 py-2 dark:border-border-dark dark:bg-canvas-obsidian"
                />
              </label>

              <label className="block text-sm font-medium">
                Tags and keywords
                <input
                  {...register('tags')}
                  aria-describedby="upload-tags-help"
                  placeholder="Add comma-separated tags"
                  className="mt-1 w-full rounded-lg border border-border-light bg-canvas-light px-4 py-2 dark:border-border-dark dark:bg-canvas-obsidian"
                />
                <span id="upload-tags-help" className="mt-1 block text-xs text-text-muted">
                  Up to 20 tags · {getMetadata({ ...getValues(), tags: tagValue }).tags.length}/20
                </span>
              </label>

              <label className="block text-sm font-medium">
                Category
                <select {...register('category')} className="mt-1 w-full rounded-lg border border-border-light bg-canvas-light px-3 py-2 dark:border-border-dark dark:bg-canvas-obsidian">
                  {categories.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
                </select>
              </label>

              <label className="block text-sm font-medium">
                Language
                <input
                  {...register('language', { required: 'Enter the video language.', minLength: 2, maxLength: 35 })}
                  maxLength={35}
                  placeholder="e.g. en"
                  className="mt-1 w-full rounded-lg border border-border-light bg-canvas-light px-4 py-2 dark:border-border-dark dark:bg-canvas-obsidian"
                />
              </label>

              <label className="block text-sm font-medium">
                Visibility
                <select {...register('visibility')} className="mt-1 w-full rounded-lg border border-border-light bg-canvas-light px-3 py-2 dark:border-border-dark dark:bg-canvas-obsidian">
                  <option value="PUBLIC">Public</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </label>

              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input {...register('madeForKids')} type="checkbox" className="mt-1 accent-brand-action" />
                <span>This video is made for children.</span>
              </label>

              <label className="block text-sm font-medium sm:col-span-2">
                Custom thumbnail
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setThumbnailFile(event.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm file:mr-3 file:rounded-control file:border-0 file:bg-surface-subtle file:px-3 file:py-2"
                />
                <span className="mt-1 block text-xs text-text-muted">JPEG, PNG, or WebP · 5 MB maximum · at least 320 × 180 pixels.</span>
              </label>

              <div className="rounded-control border border-border bg-surface-subtle p-3 text-sm sm:col-span-2">
                <h3 className="font-semibold">Copyright and publication</h3>
                <p className="mt-1 text-xs text-text-muted">
                  Only upload content you own or have permission to use. Do not upload copyrighted work without authorization.
                  WatchTube does not currently run automated copyright matching. Creator declarations are not detection results;
                  submitted claims are reviewed by an administrator.
                </p>
                <label className="mt-3 flex items-start gap-2">
                  <input
                    {...register('copyrightDeclared')}
                    type="checkbox"
                    disabled={Boolean(videoId && copyrightDeclaredValue)}
                    className="mt-1 accent-brand-action disabled:opacity-70"
                  />
                  <span>I own this content or have permission to upload and publish it.</span>
                </label>
                {videoId && copyrightDeclaredValue && (
                  <p className="mt-1 text-xs text-text-muted">This declaration is recorded and cannot be withdrawn from this upload.</p>
                )}
                <p className="mt-2 text-xs text-text-muted">
                  Review status: {copyrightReviewStatus === 'BLOCKED' ? 'Blocked by a verified claim' : 'Not automatically scanned'}.
                </p>
              </div>
            </div>

            {phase === 'uploading' && (
              <div aria-live="polite">
                <progress aria-label="Video upload progress" max={100} value={progress} className="h-2 w-full accent-brand-action" />
                <p className="mt-1 text-xs text-text-muted">Uploading: {progress}%</p>
                <button type="button" onClick={() => uploadController.current?.abort()} className="mt-2 rounded-control border border-border px-3 py-1.5 text-sm">Cancel upload</button>
              </div>
            )}
            {phase === 'verifying' && <p role="status">Verifying the uploaded file…</p>}
            {phase === 'processing' && <p role="status">Processing privately. Your video is not published yet…</p>}
            {phase === 'ready-to-publish' && <p role="status">Processing complete. Review your details and publish when ready.</p>}
            {phase === 'published' && <p role="status">Video published. Copyright review status: {copyrightReviewStatus === 'BLOCKED' ? 'Blocked' : 'Not automatically scanned'}.</p>}
            {videoStatus === 'UPLOADED' && <p role="status">Upload received. Retry verification to start processing.</p>}
            {videoStatus === 'FAILED' && <p role="alert">Processing failed. This video is not published.</p>}
            {videoStatus === 'BLOCKED' && <p role="alert">Publication is blocked by a verified copyright claim.</p>}
            {error && <p role="alert" className="text-sm text-status-warning">{error}</p>}
          </div>

          <div className="flex flex-wrap justify-between gap-2 border-t border-border-light p-4 dark:border-border-dark">
            <button type="button" onClick={onClose} disabled={isBusy} className="rounded-control px-4 py-2 text-sm font-medium disabled:opacity-50">
              Close
            </button>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {videoId && ['UPLOADED', 'FAILED'].includes(videoStatus) && (
                <button type="button" onClick={retryVerification} disabled={isBusy} className="rounded-control border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
                  Retry processing
                </button>
              )}
              {phase === 'ready-to-publish' && videoId && (
                <button type="button" onClick={publishVideo} disabled={isBusy} className="rounded-control bg-brand-action px-5 py-2 font-bold text-brand-foreground disabled:opacity-50">
                  Publish video
                </button>
              )}
              {file && !['PROCESSING', 'READY_FOR_REVIEW', 'PUBLISHED', 'FAILED', 'BLOCKED', 'REJECTED'].includes(videoStatus) && (
                <button type="button" onClick={beginUpload} disabled={isBusy} className="rounded-control bg-brand-action px-5 py-2 font-bold text-brand-foreground disabled:opacity-50">
                  {phase === 'upload-error' ? `Retry upload${uploadAttempts > 1 ? ' again' : ''}` : 'Upload video'}
                </button>
              )}
              {['ready', 'ready-to-publish', 'published', 'request-error'].includes(phase) && (
                <button type="submit" disabled={isBusy} className="rounded-control border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
                  {videoId ? 'Save changes' : 'Save draft'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
