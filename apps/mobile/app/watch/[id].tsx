import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ViewerComment, ViewerVideo } from '@watchtube/types';
import { useAuthSession } from '@/auth/AuthProvider';
import { apiGet, apiPost, getApiErrorMessage, isUnauthorizedError } from '@/api/client';
import {
  appendUniqueComments,
  getPlayableVariants,
  parseCommentsPage,
  parseReaction,
  parseSubscription,
  parseViewerVideo,
  type PlayableVideoVariant,
} from '@/api/contracts';
import {
  getVisibleReaction,
  reactionStateReducer,
  type ReactionState,
} from '@/api/reactionState';
import { ActionButton, EmptyState, ErrorState, LoadingState } from '@/components/ViewerStates';
import { colors } from '@/theme';
import { formatChannelHandle, formatPublishedDate, formatViewCount } from '@/utils/format';
import { goBackOrHome } from '@/utils/navigation';

interface VideoResult {
  key: string;
  video?: ViewerVideo;
  error?: string;
}

interface CommentsResult {
  key: string;
  comments: ViewerComment[];
  nextCursor?: string;
  error?: string;
}

interface SubscriptionResult {
  key: string;
  isSubscribed: boolean | null;
}

const initialReactionState: ReactionState | undefined = undefined;

function toVideoSource(url: string): VideoSource {
  const isHls = /\.m3u8(\?|$)/i.test(url);
  return {
    uri: url,
    contentType: isHls ? 'hls' : 'auto',
  };
}

function NativePlayer({
  variants,
  playerHeight,
  isFocused,
  appIsActive,
}: {
  variants: PlayableVideoVariant[];
  playerHeight: number;
  isFocused: boolean;
  appIsActive: boolean;
}) {
  const [selectedUrl, setSelectedUrl] = useState(variants[0].playlistUrl);
  const activeUrl = variants.some((v) => v.playlistUrl === selectedUrl)
    ? selectedUrl
    : variants[0].playlistUrl;
  const player = useVideoPlayer(toVideoSource(activeUrl));
  const [status, setStatus] = useState(player.status);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(player.muted);
  const [isPlaying, setIsPlaying] = useState(player.playing);

  useEffect(() => {
    const statusSub = player.addListener('statusChange', (event) => {
      setStatus(event.status);
      if (event.status === 'error') {
        setErrorMessage(event.error?.message || 'This video could not be played.');
      } else {
        setErrorMessage(null);
      }
    });
    const mutedSub = player.addListener('mutedChange', (event) => {
      setIsMuted(event.muted);
    });
    const playingSub = player.addListener('playingChange', (event) => {
      setIsPlaying(event.isPlaying);
    });

    return () => {
      statusSub.remove();
      mutedSub.remove();
      playingSub.remove();
    };
  }, [player]);

  useEffect(() => {
    if (!isFocused || !appIsActive) {
      player.pause();
    }
  }, [appIsActive, isFocused, player]);

  const switchVariant = async (nextUrl: string) => {
    setSelectedUrl(nextUrl);
    setStatus('loading');
    setErrorMessage(null);
    try {
      await player.replaceAsync(toVideoSource(nextUrl));
    } catch {
      setStatus('error');
      setErrorMessage('Failed to switch video quality.');
    }
  };

  const retryPlayback = () => {
    setStatus('loading');
    setErrorMessage(null);
    void player.replaceAsync(toVideoSource(activeUrl)).catch(() => {
      setStatus('error');
      setErrorMessage('This video could not be played.');
    });
  };

  const togglePlay = () => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  const toggleMute = () => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  return (
    <View>
      <View style={[styles.player, { height: playerHeight }]}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls
          fullscreenOptions={{ enable: true, orientation: 'landscape' }}
          allowsPictureInPicture={false}
          contentFit="contain"
        />
        {status === 'loading' ? (
          <View pointerEvents="none" style={styles.playerOverlay}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : status === 'error' ? (
          <View style={styles.playerOverlay}>
            <Text style={styles.playerError}>{errorMessage ?? 'This video could not be played.'}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry video playback"
              onPress={retryPlayback}
              style={styles.playerRetry}
            >
              <Text style={styles.playerRetryText}>Retry playback</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.playerControlsBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
          onPress={togglePlay}
          style={styles.controlChip}
        >
          <Text style={styles.controlChipText}>{isPlaying ? 'Pause' : 'Play'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute audio' : 'Mute audio'}
          onPress={toggleMute}
          style={[styles.controlChip, isMuted && styles.controlChipActive]}
        >
          <Text style={styles.controlChipText}>{isMuted ? 'Muted' : 'Sound On'}</Text>
        </Pressable>
        {variants.length > 1 ? (
          <View style={styles.qualityGroup}>
            {variants.map((variant) => (
              <Pressable
                key={variant.resolution}
                accessibilityRole="button"
                accessibilityState={{ selected: activeUrl === variant.playlistUrl }}
                accessibilityLabel={`Switch video quality to ${variant.resolution}`}
                onPress={() => void switchVariant(variant.playlistUrl)}
                style={[
                  styles.controlChip,
                  activeUrl === variant.playlistUrl && styles.controlChipActive,
                ]}
              >
                <Text style={styles.controlChipText}>{variant.resolution}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function WatchScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(routeId) ? routeId[0] : routeId;
  const router = useRouter();
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user, refreshSession } = useAuthSession();
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');

  const [videoResult, setVideoResult] = useState<VideoResult>();
  const [retryVideo, setRetryVideo] = useState(0);
  const [commentsResult, setCommentsResult] = useState<CommentsResult>();
  const [loadingMoreCommentsKey, setLoadingMoreCommentsKey] = useState<string | null>(null);
  const [moreCommentsError, setMoreCommentsError] = useState<{ key: string; message: string }>();
  const [refreshComments, setRefreshComments] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isUpdatingReaction, setIsUpdatingReaction] = useState(false);
  const [isUpdatingSubscription, setIsUpdatingSubscription] = useState(false);
  const [reactionRetry, setReactionRetry] = useState(0);
  const [reactionState, dispatchReaction] = useReducer(
    reactionStateReducer,
    initialReactionState,
  );
  const [subscriptionResult, setSubscriptionResult] = useState<SubscriptionResult>();
  const [avatarFailed, setAvatarFailed] = useState(false);

  const videoRequestKey = `${id ?? ''}:${retryVideo}`;
  const videoResultIsCurrent = videoResult?.key === videoRequestKey;
  const video = videoResultIsCurrent ? videoResult.video ?? null : null;
  const isLoadingVideo = Boolean(id) && !videoResultIsCurrent;
  const videoError = videoResultIsCurrent ? videoResult.error ?? null : id ? null : 'This video link is invalid.';
  const commentsKey = `${id ?? ''}:${refreshComments}`;
  const commentsResultIsCurrent = commentsResult?.key === commentsKey;
  const comments = commentsResultIsCurrent ? commentsResult.comments : [];
  const commentsCursor = commentsResultIsCurrent ? commentsResult.nextCursor : undefined;
  const commentsError = commentsResultIsCurrent ? commentsResult.error ?? null : null;
  const isLoadingComments = Boolean(id) && !commentsResultIsCurrent;
  const isLoadingMoreComments = loadingMoreCommentsKey === commentsKey;
  const currentMoreCommentsError = moreCommentsError?.key === commentsKey ? moreCommentsError.message : null;
  const channelId = video?.channelId ?? video?.channel.id;
  const subscriptionKey = `${user?.id ?? ''}:${channelId ?? ''}`;
  const subscriptionResultIsCurrent = subscriptionResult?.key === subscriptionKey;
  const isSubscribed = subscriptionResultIsCurrent ? subscriptionResult.isSubscribed : null;
  const isLoadingSubscriptionStatus = Boolean(user && channelId) && !subscriptionResultIsCurrent;
  const reactionKey = `${user?.id ?? ''}:${id ?? ''}:${reactionRetry}`;
  const reactionStateIsCurrent = reactionState?.key === reactionKey;
  const reaction = getVisibleReaction(reactionState, reactionKey, Boolean(user));
  const reactionError = reactionStateIsCurrent && reactionState.status === 'error'
    ? reactionState.error ?? null
    : null;
  const isLoadingReactionStatus = Boolean(user && id)
    && (!reactionStateIsCurrent || reactionState.status === 'loading');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!id) return;

    const controller = new AbortController();
    apiGet<unknown>(`/videos/${encodeURIComponent(id)}`, undefined, controller.signal)
      .then((result) => setVideoResult({ key: videoRequestKey, video: parseViewerVideo(result) }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setVideoResult({
            key: videoRequestKey,
            error: getApiErrorMessage(error, 'This video is unavailable.'),
          });
        }
      });

    return () => controller.abort();
  }, [id, videoRequestKey]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiGet<unknown>(`/videos/${encodeURIComponent(id)}/comments`, undefined, controller.signal)
      .then((data) => {
        const result = parseCommentsPage(data);
        setCommentsResult({
          key: commentsKey,
          comments: result.comments,
          nextCursor: result.nextCursor,
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCommentsResult({
            key: commentsKey,
            comments: [],
            error: getApiErrorMessage(error, 'Comments are temporarily unavailable.'),
          });
        }
      });
    return () => controller.abort();
  }, [commentsKey, id]);

  useEffect(() => {
    if (!user || !id) return;
    const controller = new AbortController();
    dispatchReaction({ type: 'load', key: reactionKey });
    apiGet<unknown>(
      `/videos/${encodeURIComponent(id)}/like-status`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        dispatchReaction({ type: 'loaded', key: reactionKey, reaction: parseReaction(data) });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          dispatchReaction({
            type: 'failed',
            key: reactionKey,
            error: getApiErrorMessage(error, 'Your reaction status could not be loaded.'),
          });
          if (isUnauthorizedError(error)) void refreshSession();
        }
      });
    return () => controller.abort();
  }, [id, reactionKey, refreshSession, user]);

  useEffect(() => {
    if (!user || !channelId) return;
    const controller = new AbortController();
    apiGet<unknown>(
      `/channels/${encodeURIComponent(channelId)}/subscription-status`,
      undefined,
      controller.signal,
    )
      .then((result) => setSubscriptionResult({
        key: subscriptionKey,
        isSubscribed: parseSubscription(result),
      }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (isUnauthorizedError(error)) {
            void refreshSession();
          } else {
            setActionError(getApiErrorMessage(error, 'Subscription status could not be loaded.'));
            setSubscriptionResult({ key: subscriptionKey, isSubscribed: null });
          }
        }
      });
    return () => controller.abort();
  }, [channelId, refreshSession, subscriptionKey, user]);

  const playableVariants = useMemo(
    () => getPlayableVariants(video?.variants),
    [video?.variants],
  );
  const videoDate = formatPublishedDate(video?.publishedAt, video?.createdAt);
  const availableWidth = Math.max(240, width - insets.left - insets.right);
  const playerHeight = Math.min(availableWidth * (9 / 16), Math.max(200, height * 0.62), 540);

  const updateReaction = async (isDislike: boolean) => {
    if (!user) {
      router.push('/account');
      return;
    }
    if (!video) return;
    setActionError(null);
    setIsUpdatingReaction(true);
    try {
      const result = await apiPost<unknown>(
        `/videos/${encodeURIComponent(video.id)}/like`,
        { isDislike },
      );
      dispatchReaction({
        type: 'updated',
        key: reactionKey,
        reaction: parseReaction(result),
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await refreshSession();
        router.push('/account');
      } else {
        setActionError(getApiErrorMessage(error, 'Your reaction could not be saved.'));
      }
    } finally {
      setIsUpdatingReaction(false);
    }
  };

  const toggleSubscription = async () => {
    if (!user) {
      router.push('/account');
      return;
    }
    if (!channelId) {
      setActionError('This channel cannot be subscribed to from this video.');
      return;
    }
    setActionError(null);
    setIsUpdatingSubscription(true);
    try {
      const result = await apiPost<unknown>(
        `/channels/${encodeURIComponent(channelId)}/subscribe`,
      );
      setSubscriptionResult({ key: subscriptionKey, isSubscribed: parseSubscription(result) });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await refreshSession();
        router.push('/account');
      } else {
        setActionError(getApiErrorMessage(error, 'Your subscription could not be updated.'));
      }
    } finally {
      setIsUpdatingSubscription(false);
    }
  };

  const postComment = async () => {
    const content = commentText.trim();
    if (!user) {
      router.push('/account');
      return;
    }
    if (!content || !video) return;
    setIsPostingComment(true);
    setCommentError(null);
    try {
      await apiPost(`/videos/${encodeURIComponent(video.id)}/comments`, { content });
      setCommentText('');
      setRefreshComments((current) => current + 1);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await refreshSession();
        router.push('/account');
      } else {
        setCommentError(getApiErrorMessage(error, 'Your comment could not be posted.'));
      }
    } finally {
      setIsPostingComment(false);
    }
  };

  const loadMoreComments = async () => {
    if (!id || !commentsCursor || isLoadingMoreComments || !commentsResultIsCurrent) return;
    setLoadingMoreCommentsKey(commentsKey);
    setMoreCommentsError(undefined);
    try {
      const data = await apiGet<unknown>(`/videos/${encodeURIComponent(id)}/comments`, {
        cursor: commentsCursor,
      });
      const result = parseCommentsPage(data);
      setCommentsResult((current) => current?.key === commentsKey
        ? {
          ...current,
          comments: appendUniqueComments(current.comments, result.comments),
          nextCursor: result.nextCursor,
        }
        : current);
    } catch (error) {
      setMoreCommentsError({
        key: commentsKey,
        message: getApiErrorMessage(error, 'More comments could not be loaded.'),
      });
    } finally {
      setLoadingMoreCommentsKey((current) => current === commentsKey ? null : current);
    }
  };

  const refreshAll = () => {
    setRetryVideo((current) => current + 1);
    setRefreshComments((current) => current + 1);
    setReactionRetry((current) => current + 1);
  };

  if (isLoadingVideo && !video) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        <Pressable accessibilityRole="button" onPress={() => goBackOrHome(router)} style={styles.back}>
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <LoadingState label="Loading video…" />
      </SafeAreaView>
    );
  }

  if (videoError || !video) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        <Pressable accessibilityRole="button" onPress={() => goBackOrHome(router)} style={styles.back}>
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <ErrorState
          message={videoError ?? 'This video is unavailable.'}
          onRetry={id ? () => setRetryVideo((current) => current + 1) : undefined}
        />
      </SafeAreaView>
    );
  }

  const displayHandle = formatChannelHandle(video.channel.handle);

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={12}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isLoadingVideo}
              onRefresh={refreshAll}
              tintColor={colors.accent}
            />
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => goBackOrHome(router)}
            style={styles.back}
          >
            <Text style={styles.backText}>‹  Back</Text>
          </Pressable>

          {playableVariants.length > 0 ? (
            <NativePlayer
              key={video.id}
              variants={playableVariants}
              playerHeight={playerHeight}
              isFocused={isFocused}
              appIsActive={appIsActive}
            />
          ) : (
            <View style={[styles.player, styles.playerUnavailable, { height: playerHeight }]}>
              <EmptyState title="Video is not ready to play" message="This video has no published playback stream yet." />
            </View>
          )}

          <View style={styles.details}>
            <Text style={styles.title}>{video.title}</Text>
            <Text style={styles.meta}>
              {formatViewCount(video.viewsCount)}{videoDate ? ` · ${videoDate}` : ''}
            </Text>

            <View style={styles.channelRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View channel ${video.channel.name}`}
                onPress={() => router.push({
                  pathname: '/channel/[handle]',
                  params: { handle: displayHandle },
                })}
                style={styles.channelInfoPressable}
              >
                {video.channel.avatarUrl && !avatarFailed ? (
                  <Image
                    source={{ uri: video.channel.avatarUrl }}
                    style={styles.avatar}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <View style={[styles.avatar, styles.avatarEmpty]}>
                    <Text style={styles.avatarFallback}>{video.channel.name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.channelDetails}>
                  <Text numberOfLines={1} style={styles.channelName}>{video.channel.name}</Text>
                  <Text numberOfLines={1} style={styles.channelHandle}>{displayHandle}</Text>
                </View>
              </Pressable>
              <ActionButton
                title={
                  isUpdatingSubscription ? 'Please wait…'
                    : isLoadingSubscriptionStatus ? 'Checking…'
                      : isSubscribed ? 'Subscribed' : 'Subscribe'
                }
                onPress={() => void toggleSubscription()}
                disabled={isUpdatingSubscription || isLoadingSubscriptionStatus}
                secondary={Boolean(isSubscribed)}
              />
            </View>

            <View style={styles.reactions}>
              <ActionButton
                title={reaction === 'liked' ? 'Liked' : 'Like'}
                onPress={() => void updateReaction(false)}
                disabled={isUpdatingReaction || isLoadingReactionStatus}
                secondary={reaction !== 'liked'}
              />
              <ActionButton
                title={reaction === 'disliked' ? 'Disliked' : 'Dislike'}
                onPress={() => void updateReaction(true)}
                disabled={isUpdatingReaction || isLoadingReactionStatus}
                secondary={reaction !== 'disliked'}
              />
            </View>
            {!user ? (
              <Pressable onPress={() => router.push('/account')} style={styles.reactionPrompt}>
                <Text style={styles.signInText}>Sign in to like or dislike this video</Text>
              </Pressable>
            ) : null}
            {isLoadingReactionStatus ? (
              <View style={styles.reactionStatus}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.statusText}>Loading your reaction…</Text>
              </View>
            ) : null}
            {reactionError ? (
              <View style={styles.reactionStatus}>
                <Text style={styles.error}>{reactionError}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReactionRetry((current) => current + 1)}
                  style={styles.retry}
                >
                  <Text style={styles.signInText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

            {video.description ? (
              <View style={styles.description}>
                <Text style={styles.descriptionText}>{video.description}</Text>
              </View>
            ) : null}

            <View style={styles.commentsSection}>
              <Text style={styles.sectionTitle}>Comments</Text>
              {user ? (
                <View style={styles.commentForm}>
                  <TextInput
                    accessibilityLabel="Write a comment"
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder="Add a comment…"
                    placeholderTextColor={colors.muted}
                    multiline
                    maxLength={1000}
                    style={styles.commentInput}
                  />
                  <ActionButton
                    title={isPostingComment ? 'Posting…' : 'Comment'}
                    onPress={() => void postComment()}
                    disabled={isPostingComment || !commentText.trim()}
                  />
                </View>
              ) : (
                <Pressable onPress={() => router.push('/account')} style={styles.signInPrompt}>
                  <Text style={styles.signInText}>Sign in to leave a comment</Text>
                </Pressable>
              )}
              {commentError ? <Text style={styles.error}>{commentError}</Text> : null}

              {isLoadingComments ? (
                <LoadingState label="Loading comments…" />
              ) : commentsError && comments.length === 0 ? (
                <ErrorState message={commentsError} onRetry={() => setRefreshComments((current) => current + 1)} />
              ) : comments.length === 0 ? (
                <EmptyState title="No comments yet" message="Be the first to join the conversation." />
              ) : (
                <View style={styles.commentList}>
                  {comments.map((comment) => {
                    const author = comment.user?.channels?.[0];
                    return (
                      <View key={comment.id} style={styles.comment}>
                        <Text style={styles.commentAuthor}>{author?.name ?? 'WatchTube viewer'}</Text>
                        <Text style={styles.commentText}>{comment.content}</Text>
                      </View>
                    );
                  })}
                  {currentMoreCommentsError ? <Text style={styles.error}>{currentMoreCommentsError}</Text> : null}
                  {commentsCursor ? (
                    <ActionButton
                      title={isLoadingMoreComments ? 'Loading…' : 'Load more comments'}
                      onPress={() => void loadMoreComments()}
                      disabled={isLoadingMoreComments}
                      secondary
                    />
                  ) : null}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 28 },
  back: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18 },
  backText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  player: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  playerUnavailable: { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  playerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0008',
    padding: 20,
  },
  playerError: { color: colors.text, textAlign: 'center', fontWeight: '600' },
  playerRetry: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  playerRetryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  playerControlsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  qualityGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' },
  controlChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlChipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  controlChipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  details: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: 18 },
  title: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 7 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  channelInfoPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmpty: { borderWidth: 1, borderColor: colors.border },
  avatarFallback: { color: colors.text, fontSize: 16, fontWeight: '800' },
  channelDetails: { flex: 1, minWidth: 0 },
  channelName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  channelHandle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  reactions: { flexDirection: 'row', gap: 8, paddingVertical: 14 },
  reactionPrompt: { minHeight: 44, justifyContent: 'center' },
  reactionStatus: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  statusText: { color: colors.muted, fontSize: 13 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginVertical: 6 },
  description: { borderRadius: 14, backgroundColor: colors.surface, padding: 14, marginTop: 4 },
  descriptionText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  commentsSection: { marginTop: 24 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '800', marginBottom: 12 },
  commentForm: { gap: 10, paddingBottom: 14 },
  commentInput: {
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  signInPrompt: { minHeight: 44, justifyContent: 'center', paddingBottom: 12 },
  signInText: { color: colors.accent, fontWeight: '700' },
  commentList: { gap: 12 },
  comment: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  commentAuthor: { color: colors.text, fontSize: 13, fontWeight: '700' },
  commentText: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 5 },
});
