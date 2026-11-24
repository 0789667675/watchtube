import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiPatch, apiPost, getApiErrorMessage, isUnauthorizedError } from '@/api/client';
import {
  VIDEO_CATEGORIES,
  parseCreatorVideoDetail,
  parsePublishResponse,
  parseUploadDraft,
  parseUploadIntent,
  parseUploadStatus,
  parseUploadUrlRefresh,
  parseVerifyUploadResponse,
  type VideoCategory,
  type VideoStatus,
  type VideoVisibility,
} from '@/api/contracts';
import {
  UploadStageError,
  isTerminalProcessingStatus,
  parseTagsInput,
  retryBinaryTransferAndVerify,
  runCreatorUploadPipeline,
  validateMetadataInput,
  validateSelectedVideoFile,
  validateShortVideoDimensions,
  type SelectedVideoAsset,
  type UploadWorkflowClient,
  type VideoMetadataFormInput,
} from '@/api/uploadWorkflow';
import { useAuthSession } from '@/auth/AuthProvider';
import { ActionButton, EmptyState, ErrorState, LoadingState } from '@/components/ViewerStates';
import { pickVideoForUpload, transferVideoBinary } from '@/studio/mediaUpload';
import { colors } from '@/theme';
import { formatChannelHandle, formatDuration, formatFileSize } from '@/utils/format';
import { goBackOrHome } from '@/utils/navigation';

type UiStage =
  | 'form'
  | 'uploading'
  | 'transfer-error'
  | 'verify-error'
  | 'processing'
  | 'ready-to-publish'
  | 'published'
  | 'blocked';

function statusToUiStage(status: VideoStatus): UiStage {
  switch (status) {
    case 'UPLOADED':
      return 'verify-error';
    case 'PROCESSING':
      return 'processing';
    case 'READY_FOR_REVIEW':
      return 'ready-to-publish';
    case 'PUBLISHED':
    case 'READY':
      return 'published';
    case 'BLOCKED':
    case 'REJECTED':
      return 'blocked';
    case 'FAILED':
      return 'verify-error';
    default:
      return 'form';
  }
}

export default function StudioUploadScreen() {
  const router = useRouter();
  const { videoId: routeVideoId } = useLocalSearchParams<{ videoId?: string | string[] }>();
  const initialVideoId = Array.isArray(routeVideoId) ? routeVideoId[0] : routeVideoId;
  const { user, refreshSession } = useAuthSession();
  const channel = user?.channels?.[0];

  const [detailRetry, setDetailRetry] = useState(0);
  const [loadedDetailKey, setLoadedDetailKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const detailKey = initialVideoId && user ? `${user.id}:${initialVideoId}:${detailRetry}` : null;
  const isLoadingExisting = Boolean(detailKey && loadedDetailKey !== detailKey);

  const [selectedFile, setSelectedFile] = useState<SelectedVideoAsset | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<VideoCategory>('ENTERTAINMENT');
  const [tagsInput, setTagsInput] = useState('');
  const [language, setLanguage] = useState('en');
  const [madeForKids, setMadeForKids] = useState(false);
  const [visibility, setVisibility] = useState<VideoVisibility>('PUBLIC');
  const [isShort, setIsShort] = useState(false);
  const [copyrightDeclared, setCopyrightDeclared] = useState(false);
  const [serverCopyrightDeclared, setServerCopyrightDeclared] = useState(false);

  const [stage, setStage] = useState<UiStage>('form');
  const [videoId, setVideoId] = useState<string | null>(initialVideoId ?? null);
  const [serverStatus, setServerStatus] = useState<VideoStatus>('DRAFT');
  const [copyrightReviewStatus, setCopyrightReviewStatus] = useState<'NOT_SCANNED' | 'BLOCKED'>('NOT_SCANNED');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isPickingFile, setIsPickingFile] = useState(false);
  const transferAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!detailKey || !initialVideoId) return;
    const controller = new AbortController();
    apiGet<unknown>(`/videos/${encodeURIComponent(initialVideoId)}`, undefined, controller.signal)
      .then((data) => {
        const detail = parseCreatorVideoDetail(data);
        setLoadError(null);
        setVideoId(detail.videoId);
        setIsShort(detail.isShort);
        setTitle(detail.title);
        setDescription(detail.description ?? '');
        setTagsInput(detail.tags.join(', '));
        setCategory(detail.category);
        setLanguage(detail.language);
        setMadeForKids(detail.madeForKids);
        setVisibility(detail.visibility);
        setCopyrightDeclared(detail.copyrightDeclared);
        setServerCopyrightDeclared(detail.copyrightDeclared);
        setServerStatus(detail.status);
        setCopyrightReviewStatus(detail.copyrightReviewStatus);
        setStage(statusToUiStage(detail.status));
        if (detail.status === 'FAILED') {
          setErrorMessage('Processing failed. Retry verification/processing or re-upload the video file.');
        } else if (detail.status === 'BLOCKED') {
          setErrorMessage('Publication is blocked by a verified copyright claim.');
        } else if (detail.status === 'REJECTED') {
          setErrorMessage('This video was rejected and cannot be published.');
        }
        setLoadedDetailKey(detailKey);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          if (isUnauthorizedError(err)) {
            void refreshSession();
          }
          setLoadError(getApiErrorMessage(err, 'Could not load video upload details.'));
          setLoadedDetailKey(detailKey);
        }
      });

    return () => controller.abort();
  }, [detailKey, initialVideoId, refreshSession]);

  const refreshUploadStatus = useCallback(async (id: string): Promise<VideoStatus | null> => {
    try {
      const raw = await apiGet<unknown>(`/videos/${encodeURIComponent(id)}/upload-status`);
      const parsed = parseUploadStatus(raw);
      setServerStatus(parsed.status);
      setCopyrightReviewStatus(parsed.copyrightReviewStatus);
      if (parsed.status === 'READY_FOR_REVIEW') {
        setStage('ready-to-publish');
        setStatusMessage('Processing complete. Review details and confirm publication.');
      } else if (parsed.status === 'PUBLISHED' || parsed.status === 'READY') {
        setStage('published');
        setStatusMessage('Video published.');
      } else if (parsed.status === 'BLOCKED' || parsed.status === 'REJECTED') {
        setStage('blocked');
        setErrorMessage(
          parsed.status === 'BLOCKED'
            ? 'Publication is blocked by a verified copyright claim.'
            : 'Processing rejected this video.',
        );
      } else if (parsed.status === 'FAILED') {
        setStage('verify-error');
        setErrorMessage('Video processing failed. Retry verification or upload a new file.');
      } else if (parsed.status === 'UPLOADED') {
        setStage('verify-error');
        setStatusMessage('Raw object uploaded; verification/queuing still pending.');
      }
      return parsed.status;
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        await refreshSession();
      }
      setErrorMessage(getApiErrorMessage(err, 'Could not refresh processing status.'));
      return null;
    }
  }, [refreshSession]);

  useEffect(() => {
    if (stage !== 'processing' || !videoId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const nextStatus = await refreshUploadStatus(videoId);
      if (!active) return;
      if (nextStatus && isTerminalProcessingStatus(nextStatus)) {
        return;
      }
      timer = setTimeout(() => void poll(), 2500);
    };

    timer = setTimeout(() => void poll(), 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refreshUploadStatus, stage, videoId]);

  const workflowClient: UploadWorkflowClient = useMemo(() => ({
    createDraft: async (metadata) => {
      const res = await apiPost<unknown>('/videos/drafts', metadata);
      return parseUploadDraft(res);
    },
    updateMetadata: async (id, metadata) => {
      await apiPatch<unknown>(`/videos/${encodeURIComponent(id)}`, metadata);
    },
    requestUploadIntent: async (input) => {
      const res = await apiPost<unknown>('/videos/upload-intent', input);
      return parseUploadIntent(res);
    },
    refreshUploadUrl: async (input) => {
      const res = await apiPost<unknown>(
        `/videos/${encodeURIComponent(input.videoId)}/upload-url`,
        { contentType: input.contentType, fileSize: input.fileSize },
      );
      return parseUploadUrlRefresh(res);
    },
    transferBinary: async (uploadUrl, file, onProgress) => {
      const controller = new AbortController();
      transferAbortRef.current = controller;
      setIsTransferring(true);
      try {
        await transferVideoBinary(uploadUrl, file, onProgress, controller.signal);
      } finally {
        transferAbortRef.current = null;
        setIsTransferring(false);
      }
    },
    verifyUpload: async (id) => {
      const res = await apiPost<unknown>(`/videos/${encodeURIComponent(id)}/verify-upload`);
      return parseVerifyUploadResponse(res);
    },
  }), []);

  const buildMetadata = (): VideoMetadataFormInput => ({
    channelId: channel?.id ?? '',
    isShort,
    title: title.trim(),
    description: description.trim() || null,
    tags: parseTagsInput(tagsInput),
    category,
    language: language.trim(),
    madeForKids,
    visibility,
    copyrightDeclared,
  });

  const handleSelectVideo = async () => {
    setErrorMessage(null);
    setIsPickingFile(true);
    try {
      const asset = await pickVideoForUpload();
      if (!asset) return;
      const fileError = validateSelectedVideoFile(asset, isShort);
      if (fileError) {
        setErrorMessage(fileError);
        return;
      }
      if (isShort) {
        const shortError = validateShortVideoDimensions(asset.duration, asset.width, asset.height);
        if (shortError) {
          setErrorMessage(shortError);
          return;
        }
      }
      setSelectedFile(asset);
      setUploadProgress(0);
      if (!title.trim()) {
        const derivedTitle = asset.name.replace(/\.[^/.]+$/, '').trim();
        if (derivedTitle) setTitle(derivedTitle.slice(0, 255));
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not open video file picker.');
    } finally {
      setIsPickingFile(false);
    }
  };

  const handleSaveDraftOnly = async () => {
    if (!channel) return;
    const metadata = buildMetadata();
    const validationError = validateMetadataInput(metadata);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setStatusMessage('Saving video draft…');
    setIsBusy(true);
    try {
      if (videoId) {
        const { channelId: _channelId, ...patchBody } = metadata;
        await workflowClient.updateMetadata(videoId, patchBody);
        setStatusMessage('Draft metadata updated.');
      } else {
        const draft = await workflowClient.createDraft(metadata);
        setVideoId(draft.videoId);
        setServerStatus(draft.status as VideoStatus);
        setServerCopyrightDeclared(metadata.copyrightDeclared);
        setStatusMessage('Draft saved. Select a video file whenever you are ready to upload.');
      }
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) await refreshSession();
      setErrorMessage(getApiErrorMessage(err, 'Could not save draft.'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadFailure = async (err: unknown) => {
    if (err instanceof UploadStageError) {
      if (err.videoId) {
        setVideoId(err.videoId);
        if (err.stage === 'intent' || err.stage === 'transfer') {
          setServerStatus((prev) => (prev === 'DRAFT' && err.stage === 'transfer' ? 'UPLOADING' : prev));
        }
      }
      if (isUnauthorizedError(err.originalError)) {
        await refreshSession();
      }
      setErrorMessage(err.message);
      if (err.stage === 'transfer') {
        setStage('transfer-error');
        setStatusMessage(
          err.canceled
            ? 'Binary transfer canceled. No object verification was triggered.'
            : 'Upload intent was granted, but binary file transfer did not complete.',
        );
      } else if (err.stage === 'verification') {
        setStage('verify-error');
        setStatusMessage('Binary upload completed, but server verification failed.');
      } else {
        setStage('form');
        setStatusMessage(null);
      }
      return;
    }
    setStage('form');
    setErrorMessage(getApiErrorMessage(err, 'Upload failed.'));
  };

  const handleStartUpload = async () => {
    if (!channel) {
      setErrorMessage('You must have a channel before uploading.');
      return;
    }
    if (!selectedFile) {
      setErrorMessage('Select a video file before starting the upload.');
      return;
    }

    const metadata = buildMetadata();
    const metadataError = validateMetadataInput(metadata);
    if (metadataError) {
      setErrorMessage(metadataError);
      return;
    }
    const fileError = validateSelectedVideoFile(selectedFile, metadata.isShort);
    if (fileError) {
      setErrorMessage(fileError);
      return;
    }
    if (metadata.isShort) {
      const dimsError = validateShortVideoDimensions(
        selectedFile.duration,
        selectedFile.width,
        selectedFile.height,
      );
      if (dimsError) {
        setErrorMessage(dimsError);
        return;
      }
    }

    setErrorMessage(null);
    setUploadProgress(0);
    setIsBusy(true);
    setStage('uploading');

    try {
      const result = await runCreatorUploadPipeline(
        workflowClient,
        {
          existingVideoId: videoId,
          existingStatus: serverStatus,
          metadata,
          file: selectedFile,
        },
        {
          onStage: (pipelineStage) => {
            if (pipelineStage === 'draft') setStatusMessage('Creating video draft…');
            else if (pipelineStage === 'intent') setStatusMessage('Requesting presigned R2 upload URL…');
            else if (pipelineStage === 'transfer') setStatusMessage('Uploading video binary to cloud storage…');
            else if (pipelineStage === 'verification') setStatusMessage('Verifying uploaded object & queuing transcode…');
          },
          onDraftCreated: (id, status) => {
            setVideoId(id);
            setServerStatus(status as VideoStatus);
            setServerCopyrightDeclared(true);
          },
          onIntentGranted: (id, _url, status) => {
            setVideoId(id);
            setServerStatus(status as VideoStatus);
          },
          onProgress: (percent) => setUploadProgress(percent),
        },
      );

      setServerStatus(result.status as VideoStatus);
      if (result.status === 'READY_FOR_REVIEW') {
        setStage('ready-to-publish');
        setStatusMessage('Processing complete. Confirm publication when ready.');
      } else if (result.status === 'PUBLISHED' || result.status === 'READY') {
        setStage('published');
        setStatusMessage('Video published.');
      } else {
        setStage('processing');
        setStatusMessage('Binary uploaded and verified. Transcoding in progress…');
      }
    } catch (err: unknown) {
      await handleUploadFailure(err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRetryTransfer = async () => {
    if (!videoId || !selectedFile) {
      setStage('form');
      setErrorMessage('Select the video file to transfer.');
      return;
    }
    setErrorMessage(null);
    setUploadProgress(0);
    setIsBusy(true);
    setStage('uploading');
    try {
      const result = await retryBinaryTransferAndVerify(
        workflowClient,
        videoId,
        selectedFile,
        {
          onStage: (pipelineStage) => {
            if (pipelineStage === 'intent') setStatusMessage('Refreshing presigned upload URL…');
            else if (pipelineStage === 'transfer') setStatusMessage('Uploading video binary to cloud storage…');
            else if (pipelineStage === 'verification') setStatusMessage('Verifying uploaded object & queuing transcode…');
          },
          onProgress: (percent) => setUploadProgress(percent),
        },
      );
      setServerStatus(result.status as VideoStatus);
      setStage(statusToUiStage(result.status as VideoStatus));
      setStatusMessage('Binary uploaded and verified. Transcoding in progress…');
    } catch (err: unknown) {
      await handleUploadFailure(err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRetryVerify = async () => {
    if (!videoId) return;
    setErrorMessage(null);
    setIsBusy(true);
    setStatusMessage('Verifying uploaded object with WatchTube API…');
    try {
      const result = await workflowClient.verifyUpload(videoId);
      setServerStatus(result.status as VideoStatus);
      setStage(statusToUiStage(result.status as VideoStatus));
      setStatusMessage('Upload verified! Transcoding has been queued.');
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) await refreshSession();
      setErrorMessage(getApiErrorMessage(err, 'Upload verification failed.'));
      setStage('verify-error');
    } finally {
      setIsBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!videoId) return;
    const metadata = buildMetadata();
    const validationError = validateMetadataInput(metadata);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setIsBusy(true);
    setStatusMessage('Saving metadata & publishing video…');
    try {
      const { channelId: _channelId, ...patchBody } = metadata;
      await workflowClient.updateMetadata(videoId, patchBody);
      const raw = await apiPost<unknown>(`/videos/${encodeURIComponent(videoId)}/publish`);
      const published = parsePublishResponse(raw);
      setServerStatus(published.status);
      setCopyrightReviewStatus(published.copyrightReviewStatus);
      setStage('published');
      setStatusMessage('Video published and ready for viewers.');
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) await refreshSession();
      setErrorMessage(getApiErrorMessage(err, 'Video could not be published.'));
    } finally {
      setIsBusy(false);
    }
  };

  if (!user || !channel) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        <Pressable accessibilityRole="button" onPress={() => goBackOrHome(router)} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <EmptyState
          title="Channel required"
          message="Create a channel in your Account tab before uploading videos or Shorts."
        />
        <View style={styles.centerBtn}>
          <ActionButton title="Go to Account" onPress={() => router.push('/account')} />
        </View>
      </SafeAreaView>
    );
  }

  if (isLoadingExisting) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <Pressable accessibilityRole="button" onPress={() => goBackOrHome(router)} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.navTitle}>Creator Upload</Text>
          <View style={styles.navPlaceholder} />
        </View>
        <LoadingState label="Loading video details…" />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <Pressable accessibilityRole="button" onPress={() => goBackOrHome(router)} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.navTitle}>Creator Upload</Text>
          <View style={styles.navPlaceholder} />
        </View>
        <ErrorState
          message={loadError}
          onRetry={initialVideoId ? () => {
            setLoadError(null);
            setDetailRetry((c) => c + 1);
          } : undefined}
        />
      </SafeAreaView>
    );
  }

  const formatLocked = Boolean(videoId && serverStatus !== 'DRAFT');

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => goBackOrHome(router)}
            disabled={stage === 'uploading'}
            style={styles.back}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.navTitle}>{videoId ? 'Manage Upload' : 'Upload Video'}</Text>
          <View style={styles.navPlaceholder} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            {videoId ? (
              <View style={styles.statusBanner}>
                <Text style={styles.infoLabel}>Video ID: {videoId}</Text>
                <Text style={styles.statusTag}>Status: {serverStatus.replaceAll('_', ' ')}</Text>
              </View>
            ) : null}

            {stage === 'uploading' ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Uploading Video</Text>
                <Text style={styles.statusSuccess}>{statusMessage ?? 'Preparing upload…'}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
                </View>
                <Text style={styles.infoValue}>{uploadProgress}% transferred</Text>
                {isTransferring ? (
                  <ActionButton
                    title="Cancel Binary Upload"
                    onPress={() => transferAbortRef.current?.abort()}
                    secondary
                  />
                ) : (
                  <ActivityIndicator color={colors.accent} />
                )}
              </View>
            ) : null}

            {stage === 'transfer-error' ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Binary Transfer Incomplete</Text>
                {statusMessage ? <Text style={styles.hint}>{statusMessage}</Text> : null}
                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
                <View style={styles.actionBlock}>
                  <ActionButton
                    title={isBusy ? 'Retrying…' : 'Retry Binary Transfer'}
                    onPress={() => void handleRetryTransfer()}
                    disabled={isBusy}
                  />
                  <ActionButton
                    title="Choose Another Video File"
                    onPress={() => {
                      setStage('form');
                      setErrorMessage(null);
                    }}
                    disabled={isBusy}
                    secondary
                  />
                </View>
              </View>
            ) : null}

            {stage === 'verify-error' ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Verification & Processing</Text>
                {statusMessage ? <Text style={styles.hint}>{statusMessage}</Text> : null}
                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
                <View style={styles.actionBlock}>
                  <ActionButton
                    title={isBusy ? 'Verifying…' : 'Verify & Trigger Processing'}
                    onPress={() => void handleRetryVerify()}
                    disabled={isBusy}
                  />
                  {selectedFile ? (
                    <ActionButton
                      title="Re-upload Binary File"
                      onPress={() => void handleRetryTransfer()}
                      disabled={isBusy}
                      secondary
                    />
                  ) : (
                    <ActionButton
                      title="Select Video File to Re-upload"
                      onPress={() => {
                        setStage('form');
                        setErrorMessage(null);
                      }}
                      disabled={isBusy}
                      secondary
                    />
                  )}
                </View>
              </View>
            ) : null}

            {stage === 'processing' ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Processing Video</Text>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.hint}>
                  WatchTube is validating and transcoding your video. It remains private until you confirm publication.
                </Text>
                {statusMessage ? <Text style={styles.statusSuccess}>{statusMessage}</Text> : null}
                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
                <ActionButton
                  title="Refresh Processing Status"
                  onPress={() => {
                    if (videoId) void refreshUploadStatus(videoId);
                  }}
                  secondary
                />
                <ActionButton
                  title="Return to Studio"
                  onPress={() => router.replace('/studio')}
                  secondary
                />
              </View>
            ) : null}

            {stage === 'blocked' ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Upload Restricted</Text>
                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
                <ActionButton
                  title="Return to Studio"
                  onPress={() => router.replace('/studio')}
                  secondary
                />
              </View>
            ) : null}

            {(stage === 'form' || stage === 'ready-to-publish' || stage === 'published') ? (
              <View style={styles.form}>
                <Text style={styles.heading}>
                  {stage === 'published'
                    ? 'Published Video'
                    : stage === 'ready-to-publish'
                      ? 'Ready to Publish'
                      : videoId
                        ? 'Resume Draft Upload'
                        : 'New Upload'}
                </Text>
                <Text style={styles.subtitle}>
                  Channel:{' '}
                  <Text style={styles.highlight}>
                    {channel.name} ({formatChannelHandle(channel.handle)})
                  </Text>
                </Text>

                {statusMessage ? <Text style={styles.statusSuccess}>{statusMessage}</Text> : null}

                {stage === 'published' ? (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoValue}>
                      Your video is published ({visibility}).
                    </Text>
                    <Text style={styles.hint}>
                      Copyright review status: {copyrightReviewStatus === 'BLOCKED' ? 'Blocked by claim' : 'Not automatically scanned'}.
                    </Text>
                    {visibility !== 'PRIVATE' && videoId ? (
                      <ActionButton
                        title="Watch Published Video"
                        onPress={() => router.push({ pathname: '/watch/[id]', params: { id: videoId } })}
                      />
                    ) : null}
                  </View>
                ) : null}

                {stage === 'form' ? (
                  <View style={styles.field}>
                    <Text style={styles.label}>1. Select Video File *</Text>
                    <ActionButton
                      title={isPickingFile
                        ? 'Opening Picker…'
                        : selectedFile
                          ? 'Choose Different Video'
                          : 'Select Video File (MP4, WebM, MOV)'}
                      onPress={() => void handleSelectVideo()}
                      disabled={isPickingFile || isBusy}
                      secondary={Boolean(selectedFile)}
                    />
                    {selectedFile ? (
                      <View style={styles.infoBox}>
                        <Text style={styles.infoValue}>{selectedFile.name}</Text>
                        <Text style={styles.hint}>
                          {selectedFile.contentType} · {formatFileSize(selectedFile.size)}
                          {selectedFile.duration ? ` · ${formatDuration(selectedFile.duration)}` : ''}
                          {selectedFile.width && selectedFile.height
                            ? ` · ${selectedFile.width}×${selectedFile.height}`
                            : ''}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.hint}>
                        {isShort
                          ? 'Portrait 9:16 video · max 3 minutes · max 1 GB.'
                          : 'MP4, WebM, or QuickTime (.mov) · max 2 GB.'}
                      </Text>
                    )}
                  </View>
                ) : null}

                <View style={styles.switchRow}>
                  <View style={styles.switchLabel}>
                    <Text style={styles.label}>Shorts format</Text>
                    <Text style={styles.hint}>
                      {formatLocked
                        ? 'Locked once upload begins'
                        : 'Vertical 9:16 video under 3 minutes'}
                    </Text>
                  </View>
                  <Switch
                    value={isShort}
                    onValueChange={(nextValue) => {
                      setIsShort(nextValue);
                      setErrorMessage(null);
                    }}
                    disabled={formatLocked || isBusy}
                    trackColor={{ false: colors.border, true: colors.accent }}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Title *</Text>
                  <TextInput
                    accessibilityLabel="Video Title"
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Enter a descriptive title"
                    placeholderTextColor={colors.muted}
                    maxLength={255}
                    style={styles.input}
                  />
                  <Text style={styles.counter}>{title.length}/255</Text>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Description</Text>
                  <TextInput
                    accessibilityLabel="Video Description"
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Tell viewers about your video"
                    placeholderTextColor={colors.muted}
                    multiline
                    maxLength={5000}
                    style={[styles.input, styles.multiline]}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                    {VIDEO_CATEGORIES.map((cat) => (
                      <Pressable
                        key={cat}
                        accessibilityRole="button"
                        accessibilityState={{ selected: category === cat }}
                        onPress={() => setCategory(cat)}
                        style={[styles.chip, category === cat && styles.chipSelected]}
                      >
                        <Text style={[styles.chipText, category === cat && styles.chipTextSelected]}>
                          {cat.replaceAll('_', ' ')}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Tags (comma-separated, max 20)</Text>
                  <TextInput
                    accessibilityLabel="Tags"
                    value={tagsInput}
                    onChangeText={setTagsInput}
                    placeholder="music, live, review"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Language</Text>
                  <TextInput
                    accessibilityLabel="Language"
                    value={language}
                    onChangeText={setLanguage}
                    placeholder="en"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    maxLength={35}
                    style={styles.input}
                  />
                </View>

                <View style={styles.switchRow}>
                  <View style={styles.switchLabel}>
                    <Text style={styles.label}>Made for kids</Text>
                    <Text style={styles.hint}>Select if this video is directed to children</Text>
                  </View>
                  <Switch
                    value={madeForKids}
                    onValueChange={setMadeForKids}
                    disabled={isBusy}
                    trackColor={{ false: colors.border, true: colors.accent }}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Visibility</Text>
                  <View style={styles.visRow}>
                    {(['PUBLIC', 'UNLISTED', 'PRIVATE'] as const).map((v) => (
                      <Pressable
                        key={v}
                        accessibilityRole="button"
                        accessibilityState={{ selected: visibility === v }}
                        onPress={() => setVisibility(v)}
                        style={[styles.visBtn, visibility === v && styles.visBtnSelected]}
                      >
                        <Text style={[styles.visText, visibility === v && styles.visTextSelected]}>
                          {v}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: copyrightDeclared, disabled: serverCopyrightDeclared }}
                  onPress={() => {
                    if (!serverCopyrightDeclared) setCopyrightDeclared(!copyrightDeclared);
                  }}
                  style={styles.checkboxRow}
                >
                  <View style={[styles.checkbox, copyrightDeclared && styles.checkboxChecked]}>
                    {copyrightDeclared ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    I declare that I own or have permission to upload and publish this video.
                  </Text>
                </Pressable>

                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

                {stage === 'form' ? (
                  <View style={styles.actionBlock}>
                    <ActionButton
                      title={isBusy ? 'Uploading…' : 'Upload & Verify Video'}
                      onPress={() => void handleStartUpload()}
                      disabled={isBusy || !selectedFile || !title.trim() || !copyrightDeclared}
                    />
                    <ActionButton
                      title={videoId ? 'Save Draft Metadata' : 'Save Draft Only'}
                      onPress={() => void handleSaveDraftOnly()}
                      disabled={isBusy || !title.trim() || !copyrightDeclared}
                      secondary
                    />
                  </View>
                ) : stage === 'ready-to-publish' ? (
                  <View style={styles.actionBlock}>
                    <ActionButton
                      title={isBusy ? 'Publishing…' : 'Confirm & Publish Video'}
                      onPress={() => void handlePublish()}
                      disabled={isBusy || !title.trim() || !copyrightDeclared}
                    />
                    <ActionButton
                      title="Save Metadata Changes"
                      onPress={() => void handleSaveDraftOnly()}
                      disabled={isBusy || !title.trim() || !copyrightDeclared}
                      secondary
                    />
                  </View>
                ) : (
                  <View style={styles.actionBlock}>
                    <ActionButton
                      title={isBusy ? 'Saving…' : 'Save Changes'}
                      onPress={() => void handleSaveDraftOnly()}
                      disabled={isBusy || !title.trim()}
                    />
                    <ActionButton
                      title="Return to Studio"
                      onPress={() => router.replace('/studio')}
                      secondary
                    />
                  </View>
                )}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 40 },
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  backText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  navTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  navPlaceholder: { width: 50 },
  statusBanner: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  statusTag: { color: colors.text, fontSize: 13, fontWeight: '700' },
  form: { padding: 20, gap: 18 },
  heading: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: -8 },
  highlight: { color: colors.text, fontWeight: '700' },
  field: { gap: 6 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  counter: { color: colors.muted, fontSize: 11, textAlign: 'right' },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
  },
  multiline: { minHeight: 90, paddingVertical: 10, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  switchLabel: { flex: 1, gap: 2 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: colors.text, fontWeight: '700' },
  visRow: { flexDirection: 'row', gap: 8 },
  visBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  visBtnSelected: { backgroundColor: colors.accentMuted, borderWidth: 1, borderColor: colors.accent },
  visText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  visTextSelected: { color: colors.text, fontWeight: '700' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 6 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '900' },
  checkboxLabel: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  card: { padding: 20, gap: 16 },
  statusSuccess: { color: colors.success, fontSize: 14, fontWeight: '600' },
  infoBox: {
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  infoLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  actionBlock: { gap: 10 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  centerBtn: { alignItems: 'center', marginTop: 12 },
});
