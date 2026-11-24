import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { apiClient, getApiErrorMessage } from '../../api/apiClient';
import {
  MAX_VIDEO_UPLOAD_SIZE,
  MAX_SHORT_UPLOAD_SIZE,
  getUploadTransferErrorMessage,
  normalizeUploadTitle,
  retryUploadVerification,
  retryVideoUpload,
  startVideoUpload,
  UploadWorkflowError,
  validateUploadFile,
  validateShortUploadFile,
  validateUploadTitle,
  validateThumbnailFile,
  validateThumbnailDimensions,
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
  initialIsShort?: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

interface UploadForm {
  isShort: boolean;
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
  isShort: boolean;
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
  isShort: false,
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
    isShort: values.isShort,
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

function readVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const result = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(url);
      if (!Number.isFinite(result.duration) || result.width <= 0 || result.height <= 0) {
        reject(new Error('Video duration or dimensions could not be determined.'));
        return;
      }
      resolve(result);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected video could not be read.'));
    };
    video.src = url;
  });
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected thumbnail image could not be read.'));
    };
    img.src = url;
  });
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  channelId,
  initialVideoId = null,
  initialIsShort = false,
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
  const [thumbnailError, setThumbnailError] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [uploadAttempts, setUploadAttempts] = useState(0);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { errors },
  } = useForm<UploadForm>({ defaultValues });

  const titleValue = watch('title') ?? '';
  const descValue = watch('description') ?? '';
  const tagValue = watch('tags') ?? '';
  const isShortValue = watch('isShort');
  const copyrightDeclaredValue = watch('copyrightDeclared');
  const isBusy = ['saving', 'requesting', 'uploading', 'verifying'].includes(phase) || isLoadingDraft;

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
    const controller = new AbortController();

    if (!initialVideoId) {
      setVideoId(null);
      setVideoStatus('DRAFT');
      setThumbnailUrl(null);
      setThumbnailFile(null);
      setThumbnailError('');
      setFile(null);
      setCopyrightReviewStatus('NOT_SCANNED');
      setPhase('ready');
      setError('');
      setIsLoadingDraft(false);
      reset({ ...defaultValues, isShort: initialIsShort });
      return () => {
        active = false;
        controller.abort();
      };
    }

    setIsLoadingDraft(true);
    setError('');
    setThumbnailError('');
    apiClient.get<VideoDetails>(`/api/v1/videos/${initialVideoId}`, { signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        setVideoId(data.videoId);
        setVideoStatus(data.status);
        setThumbnailUrl(data.thumbnailUrl);
        setCopyrightReviewStatus(data.copyrightReviewStatus);
        const nextPhase: UploadPhase = data.status === 'PROCESSING'
          ? 'processing'
          : (data.status === 'READY_FOR_REVIEW' || data.status === 'READY')
            ? 'ready-to-publish'
            : data.status === 'PUBLISHED'
              ? 'published'
              : 'ready';
        setPhase(nextPhase);
        reset({
          isShort: data.isShort,
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
        if (!active || axios.isCancel(requestError) || controller.signal.aborted) return;
        setError(getApiErrorMessage(requestError, 'Video details could not be loaded.'));
      })
      .finally(() => {
        if (active) setIsLoadingDraft(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [initialVideoId, initialIsShort, isOpen, reset]);

  const onThumbnailSelected = async (selectedFile: File | null) => {
    if (!selectedFile) {
      setThumbnailFile(null);
      return;
    }
    const fileError = validateThumbnailFile(selectedFile);
    if (fileError) {
      setError(fileError);
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
      return;
    }
    try {
      const dimensions = await readImageDimensions(selectedFile);
      const dimensionError = validateThumbnailDimensions(dimensions.width, dimensions.height, getValues('isShort'));
      if (dimensionError) {
        setError(dimensionError);
        if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
        return;
      }
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'The thumbnail image could not be read.');
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
      return;
    }
    setError('');
    setThumbnailError('');
    setThumbnailFile(selectedFile);
  };

  const uploadThumbnail = useCallback(async (id: string, selectedFile: File, isShort = false) => {
    const fileError = validateThumbnailFile(selectedFile);
    if (fileError) throw new Error(fileError);

    try {
      const dimensions = await readImageDimensions(selectedFile);
      const dimensionError = validateThumbnailDimensions(dimensions.width, dimensions.height, isShort);
      if (dimensionError) throw new Error(dimensionError);
    } catch (dimErr) {
      if (dimErr instanceof Error) throw dimErr;
      throw new Error('The selected thumbnail could not be validated.');
    }

    const metadata = { contentType: selectedFile.type, fileSize: selectedFile.size };
    const target = await apiClient.post<{ uploadUrl: string }>(
      `/api/v1/videos/${id}/thumbnail-upload-intent`,
      metadata,
    );

    try {
      await axios.put(target.data.uploadUrl, selectedFile, {
        withCredentials: false,
        headers: { 'Content-Type': selectedFile.type },
      });
    } catch (putError) {
      const transferError = getUploadTransferErrorMessage(putError);
      throw new Error(transferError || 'The thumbnail file upload failed. Check network connectivity and retry.');
    }

    await apiClient.post(`/api/v1/videos/${id}/thumbnail-confirmation`, metadata);
    setThumbnailFile(null);
    setThumbnailError('');
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
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
    onUploaded();
    return id;
  }, [channelId, onUploaded, videoId]);

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
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
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
    const titleError = validateUploadTitle(getValues('title'));
    if (titleError) {
      setError(titleError);
      return;
    }
    let shortMetadata: { duration: number; width: number; height: number } | null = null;
    if (getValues('isShort')) {
      try {
        shortMetadata = await readVideoMetadata(file);
        const shortError = validateShortUploadFile(file, shortMetadata.duration, shortMetadata.width, shortMetadata.height);
        if (shortError) {
          setError(shortError);
          return;
        }
      } catch (metadataError) {
        setError(metadataError instanceof Error ? metadataError.message : 'Short video metadata could not be read.');
        return;
      }
    }
    setError('');
    setThumbnailError('');
    setPhase('requesting');
    setUploadAttempts((attempt) => attempt + 1);

    const pendingThumbnail = thumbnailFile;
    const isShort = getValues('isShort');
    let activeVideoId = videoId;

    const performThumbnailUpload = async (id: string) => {
      if (!pendingThumbnail) return;
      try {
        await uploadThumbnail(id, pendingThumbnail, isShort);
      } catch (thumbError) {
        const thumbMsg = thumbError instanceof Error ? thumbError.message : 'Thumbnail upload failed.';
        setThumbnailError(thumbMsg);
      }
    };

    try {
      if (activeVideoId && videoStatus === 'UPLOADING') {
        const id = await saveMetadata(getValues());
        activeVideoId = id;
        void performThumbnailUpload(id);
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
          {
            title: getMetadata(getValues()).title,
            contentType: file.type,
            fileSize: file.size,
            channelId,
            isShort: getValues('isShort'),
            duration: shortMetadata?.duration,
            width: shortMetadata?.width,
            height: shortMetadata?.height,
          },
          file,
          (id) => {
            activeVideoId = id;
            setVideoId(id);
            setVideoStatus('UPLOADING');
            void performThumbnailUpload(id);
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
      } else if (activeVideoId) {
        setVideoId(activeVideoId);
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
      const transferError = uploadError instanceof UploadWorkflowError && uploadError.isFileTransfer
        ? getUploadTransferErrorMessage(cause)
        : null;
      const message = cause instanceof Error && cause.message && !axios.isAxiosError(cause)
        ? cause.message
        : getApiErrorMessage(cause, fallback);
      setError(transferError ?? message);
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
    if (data.thumbnailUrl) {
      setThumbnailUrl(data.thumbnailUrl);
    }
    setCopyrightReviewStatus(data.copyrightReviewStatus);
    if (data.status === 'READY_FOR_REVIEW' || data.status === 'READY') {
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
        if (['READY_FOR_REVIEW', 'READY', 'PUBLISHED', 'FAILED', 'REJECTED', 'BLOCKED'].includes(status)) {
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
    maxSize: isShortValue ? MAX_SHORT_UPLOAD_SIZE : MAX_VIDEO_UPLOAD_SIZE,
    multiple: false,
    disabled: isBusy,
  });

  const saveDraft = async (values: UploadForm) => {
    setError('');
    setThumbnailError('');
    setPhase('saving');
    try {
      const id = await saveMetadata(values);
      if (thumbnailFile && id) {
        try {
          await uploadThumbnail(id, thumbnailFile, values.isShort);
        } catch (thumbErr) {
          const msg = thumbErr instanceof Error ? thumbErr.message : 'Thumbnail upload failed.';
          setThumbnailError(msg);
          setError(`Draft saved, but thumbnail upload failed: ${msg}`);
        }
      }
      setPhase(() => {
        if (videoStatus === 'READY_FOR_REVIEW' || videoStatus === 'READY') return 'ready-to-publish';
        if (videoStatus === 'PUBLISHED') return 'published';
        return 'ready';
      });
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Video metadata could not be saved.'));
      setPhase('request-error');
    }
  };

  const publishVideo = async () => {
    if (!videoId) return;
    if (!getValues('copyrightDeclared')) {
      setError('Declare that you own or have permission to upload this content before publishing.');
      setPhase('ready-to-publish');
      return;
    }
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

  const canPublish = videoId && (phase === 'ready-to-publish' || videoStatus === 'READY_FOR_REVIEW' || videoStatus === 'READY');

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
              {initialVideoId ? (isShortValue ? 'Edit Short' : 'Edit video') : (isShortValue ? 'Upload Short' : 'Upload video')}
            </h2>
            {videoId && <p className="mt-1 text-xs text-text-muted">Status: {videoStatus.replaceAll('_', ' ')}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={isBusy} aria-label="Close upload dialog" className="rounded-full p-1 transition hover:bg-surface-hover disabled:opacity-50">
            <X className="h-6 w-6" />
          </button>
        </div>

        {isLoadingDraft ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <p role="status" className="text-sm text-text-muted">Loading draft details…</p>
          </div>
        ) : (
          <form id="upload-form" onSubmit={handleSubmit(saveDraft)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              <div {...getRootProps()} className={`cursor-pointer rounded-card border-2 border-dashed p-6 text-center transition sm:p-9 ${isDragActive ? 'border-brand-primary bg-brand-primary/10' : 'border-border hover:border-brand-primary'}`}>
                <input {...getInputProps()} />
                <UploadCloud className="mx-auto mb-3 h-12 w-12 text-text-muted" />
                <p className="font-medium">{file ? 'Choose a different video file' : 'Select or drop a video file'}</p>
                <p className="mt-1 text-sm text-text-muted">
                  {isShortValue
                    ? 'Portrait MP4, WebM, or QuickTime · 9:16 preferred · 3 minutes maximum · 1 GB maximum.'
                    : 'MP4, WebM, or QuickTime, up to 2 GB.'}
                </p>
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

              <div className="rounded-control border border-border bg-surface-subtle p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    {...register('isShort')}
                    type="checkbox"
                    disabled={Boolean(videoId && videoStatus !== 'DRAFT')}
                    className="mt-1 accent-brand-action disabled:opacity-70"
                  />
                  <div>
                    <span className="font-medium">Publish as a Short</span>
                    <p className="text-xs text-text-muted">Vertical portrait 9:16 format, maximum 3 minutes duration, up to 1 GB.</p>
                    {videoId && videoStatus !== 'DRAFT' && (
                      <p className="mt-1 text-xs text-text-muted">Short/standard format cannot change after upload starts.</p>
                    )}
                  </div>
                </label>
              </div>

              {(file || thumbnailPreviewUrl || thumbnailUrl) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {file && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium">Video preview</p>
                        <button
                          type="button"
                          onClick={() => setFile(null)}
                          disabled={isBusy}
                          className="text-xs text-text-muted hover:text-status-warning"
                        >
                          Remove video
                        </button>
                      </div>
                      <video src={videoPreviewUrl ?? undefined} controls muted preload="metadata" className="aspect-video w-full rounded-card bg-black" />
                      <p className="mt-1 truncate text-xs text-text-muted">{file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</p>
                    </div>
                  )}
                  {(thumbnailPreviewUrl || thumbnailUrl || file) && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-medium">Thumbnail preview</p>
                        {thumbnailFile && (
                          <button
                            type="button"
                            onClick={() => {
                              setThumbnailFile(null);
                              if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
                            }}
                            disabled={isBusy}
                            className="text-xs text-text-muted hover:text-status-warning"
                          >
                            Remove custom
                          </button>
                        )}
                      </div>
                      {thumbnailPreviewUrl || thumbnailUrl ? (
                        <img
                          src={thumbnailPreviewUrl || thumbnailUrl || undefined}
                          alt="Selected video thumbnail"
                          className={`${isShortValue ? 'aspect-[9/16]' : 'aspect-video'} max-h-48 w-full rounded-card bg-surface-subtle object-cover`}
                        />
                      ) : (
                        <div className={`flex ${isShortValue ? 'aspect-[9/16]' : 'aspect-video'} max-h-48 items-center justify-center rounded-card bg-surface-subtle p-4 text-center text-xs text-text-muted`}>
                          A thumbnail will be generated after processing, or choose a custom image.
                        </div>
                      )}
                      {thumbnailFile && (
                        <p className="mt-1 truncate text-xs text-text-muted">{thumbnailFile.name} (custom)</p>
                      )}
                    </div>
                  )}
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
                  <span className="mt-1 block text-right text-xs text-text-muted">{descValue.length}/5000</span>
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
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      ref={thumbnailInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void onThumbnailSelected(event.target.files?.[0] ?? null)}
                      className="block w-full text-sm file:mr-3 file:rounded-control file:border-0 file:bg-surface-subtle file:px-3 file:py-2"
                    />
                  </div>
                  <span className="mt-1 block text-xs text-text-muted">
                    JPEG, PNG, or WebP · 5 MB maximum · at least {isShortValue ? '180 × 320 portrait pixels' : '320 × 180 pixels'}.
                  </span>
                  {thumbnailError && (
                    <span role="alert" className="mt-1 block text-xs text-status-warning">{thumbnailError}</span>
                  )}
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
              {(phase === 'ready-to-publish' || videoStatus === 'READY_FOR_REVIEW' || videoStatus === 'READY') && (
                <p role="status" className="text-sm font-medium text-brand-dark">Processing complete. Review your details and publish when ready.</p>
              )}
              {phase === 'published' && <p role="status" className="text-sm font-medium text-status-success">Video published. Review status: {copyrightReviewStatus === 'BLOCKED' ? 'Blocked' : 'Not automatically scanned'}.</p>}
              {videoStatus === 'UPLOADED' && <p role="status">Upload received. Retry processing to submit for transcoding.</p>}
              {videoStatus === 'FAILED' && <p role="alert" className="text-status-warning">Processing failed. This video is not published.</p>}
              {videoStatus === 'BLOCKED' && <p role="alert" className="text-status-warning">Publication is blocked by a verified copyright claim.</p>}
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
                {canPublish && (
                  <button type="button" onClick={publishVideo} disabled={isBusy} className="rounded-control bg-brand-action px-5 py-2 font-bold text-brand-foreground hover:bg-brand-action-hover disabled:opacity-50">
                    Publish video
                  </button>
                )}
                {file && !['PROCESSING', 'READY_FOR_REVIEW', 'READY', 'PUBLISHED', 'FAILED', 'BLOCKED', 'REJECTED'].includes(videoStatus) && (
                  <button type="button" onClick={beginUpload} disabled={isBusy} className="rounded-control bg-brand-action px-5 py-2 font-bold text-brand-foreground hover:bg-brand-action-hover disabled:opacity-50">
                    {phase === 'upload-error' ? `Retry upload${uploadAttempts > 1 ? ' again' : ''}` : 'Upload video'}
                  </button>
                )}
                {['ready', 'ready-to-publish', 'published', 'request-error'].includes(phase) && (
                  <button type="submit" disabled={isBusy} className="rounded-control border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50">
                    {videoId ? 'Save changes' : 'Save draft'}
                  </button>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
