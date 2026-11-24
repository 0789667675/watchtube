import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type FlatListProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer, type VideoPlayerStatus, type VideoSource } from 'expo-video';
import type { ViewerVideo } from '@watchtube/types';
import { apiGet, apiPost, getApiErrorMessage, isUnauthorizedError } from '@/api/client';
import {
  parseReaction,
  parseViewerVideo,
  selectPreferredPlaylistUrl,
  type ViewerReaction,
} from '@/api/contracts';
import { useAuthSession } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingState } from '@/components/ViewerStates';
import { useVideoFeed } from '@/hooks/useVideoFeed';
import { colors } from '@/theme';
import { formatChannelHandle, formatViewCount } from '@/utils/format';

const SHORTS_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 60,
};

function toShortVideoSource(url: string): VideoSource {
  const isHls = /\.m3u8(\?|$)/i.test(url);
  return {
    uri: url,
    contentType: isHls ? 'hls' : 'auto',
  };
}

interface StreamLookupResult {
  key: string;
  url: string | null;
  error: string | null;
}

interface ReactionLookupResult {
  key: string;
  value: ViewerReaction;
}

interface ShortItemProps {
  video: ViewerVideo;
  isActive: boolean;
  isNearActive: boolean;
  isFocused: boolean;
  appIsActive: boolean;
  isPausedByUser: boolean;
  onTogglePause: () => void;
  height: number;
  sideInset: number;
}

function ShortItem({
  video,
  isActive,
  isNearActive,
  isFocused,
  appIsActive,
  isPausedByUser,
  onTogglePause,
  height,
  sideInset,
}: ShortItemProps) {
  const router = useRouter();
  const { user, refreshSession } = useAuthSession();
  const initialPlaylistUrl = selectPreferredPlaylistUrl(video.variants);

  const [detailRetry, setDetailRetry] = useState(0);
  const [streamLookup, setStreamLookup] = useState<StreamLookupResult>();
  const streamKey = `${video.id}:${detailRetry}`;
  const streamResultIsCurrent = streamLookup?.key === streamKey;
  const resolvedPlaylistUrl = streamResultIsCurrent ? streamLookup.url : null;
  const detailError = !initialPlaylistUrl && streamResultIsCurrent ? streamLookup.error : null;
  const isLoadingStream = !initialPlaylistUrl && isNearActive && Boolean(video.id) && !streamResultIsCurrent;

  const playlistUrl = initialPlaylistUrl ?? resolvedPlaylistUrl;
  const player = useVideoPlayer(
    playlistUrl ? toShortVideoSource(playlistUrl) : null,
    (p) => {
      p.loop = true;
      p.muted = false;
    },
  );
  const loadedUrlRef = useRef<string | null>(playlistUrl);

  const [playerStatus, setPlayerStatus] = useState<VideoPlayerStatus>(player.status);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [reactionLookup, setReactionLookup] = useState<ReactionLookupResult>();
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [isUpdatingReaction, setIsUpdatingReaction] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const reactionKey = `${user?.id ?? ''}:${video.id}`;
  const reaction = user && reactionLookup?.key === reactionKey ? reactionLookup.value : null;

  useEffect(() => {
    if (initialPlaylistUrl || !isNearActive || !video.id) return;
    const controller = new AbortController();

    apiGet<unknown>(`/videos/${encodeURIComponent(video.id)}`, undefined, controller.signal)
      .then((data) => {
        const detail = parseViewerVideo(data);
        const url = selectPreferredPlaylistUrl(detail.variants);
        setStreamLookup({
          key: streamKey,
          url,
          error: url ? null : 'No playable stream is available for this Short yet.',
        });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setStreamLookup({
            key: streamKey,
            url: null,
            error: getApiErrorMessage(err, 'Could not load Short video stream.'),
          });
        }
      });

    return () => controller.abort();
  }, [initialPlaylistUrl, isNearActive, streamKey, video.id]);

  useEffect(() => {
    if (!playlistUrl || loadedUrlRef.current === playlistUrl) return;
    loadedUrlRef.current = playlistUrl;
    void player.replaceAsync(toShortVideoSource(playlistUrl)).catch(() => {
      setPlayerStatus('error');
      setPlaybackError('This Short could not be played.');
    });
  }, [player, playlistUrl]);

  useEffect(() => {
    const statusSub = player.addListener('statusChange', (event) => {
      setPlayerStatus(event.status);
      if (event.status === 'error') {
        setPlaybackError(event.error?.message || 'This Short could not be played.');
      } else {
        setPlaybackError(null);
      }
    });
    const mutedSub = player.addListener('mutedChange', (event) => {
      setIsMuted(event.muted);
    });
    return () => {
      statusSub.remove();
      mutedSub.remove();
    };
  }, [player]);

  useEffect(() => {
    if (isActive && isFocused && appIsActive && playlistUrl && !isPausedByUser) {
      player.play();
    } else {
      player.pause();
    }
  }, [appIsActive, isActive, isFocused, isPausedByUser, player, playlistUrl]);

  useEffect(() => {
    if (!user || !video.id) return;
    const controller = new AbortController();
    apiGet<unknown>(`/videos/${encodeURIComponent(video.id)}/like-status`, undefined, controller.signal)
      .then((data) => setReactionLookup({ key: reactionKey, value: parseReaction(data) }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setReactionLookup({ key: reactionKey, value: null });
        }
      });
    return () => controller.abort();
  }, [reactionKey, user, video.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = isMuted;
  }, [isMuted, player]);

  const toggleLike = async () => {
    if (!user) {
      router.push('/account');
      return;
    }
    setReactionError(null);
    setIsUpdatingReaction(true);
    try {
      const isDislike = reaction === 'liked';
      const result = await apiPost<unknown>(`/videos/${encodeURIComponent(video.id)}/like`, {
        isDislike,
      });
      setReactionLookup({ key: reactionKey, value: parseReaction(result) });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await refreshSession();
        router.push('/account');
      } else {
        setReactionError(getApiErrorMessage(err, 'Reaction could not be updated.'));
      }
    } finally {
      setIsUpdatingReaction(false);
    }
  };

  const retryPlayback = () => {
    if (!playlistUrl) {
      setDetailRetry((c) => c + 1);
      return;
    }
    setPlaybackError(null);
    setPlayerStatus('loading');
    void player.replaceAsync(toShortVideoSource(playlistUrl)).catch(() => {
      setPlayerStatus('error');
      setPlaybackError('This Short could not be played.');
    });
  };

  const toggleMute = () => {
    setIsMuted((current) => !current);
  };

  const compactLayout = height < 500;
  const displayHandle = formatChannelHandle(video.channel.handle);

  return (
    <View style={[styles.shortContainer, { height }]}>
      {playlistUrl ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPausedByUser ? 'Resume Short' : 'Pause Short'}
          onPress={onTogglePause}
          style={StyleSheet.absoluteFill}
        >
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
          />
        </Pressable>
      ) : video.thumbnailUrl ? (
        <Image
          source={{ uri: video.thumbnailUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.placeholderBg, StyleSheet.absoluteFill]} />
      )}

      <View style={styles.gradientOverlay} pointerEvents="none" />

      {isPausedByUser && playlistUrl && playerStatus === 'readyToPlay' ? (
        <View pointerEvents="none" style={styles.centerOverlay}>
          <View style={styles.pausedPill}>
            <Text style={styles.pausedPillText}>Paused · Tap to play</Text>
          </View>
        </View>
      ) : null}

      {(isLoadingStream || (playlistUrl && playerStatus === 'loading')) && isActive ? (
        <View pointerEvents="none" style={styles.centerOverlay}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      ) : null}

      {(detailError || (playerStatus === 'error' && playbackError)) && isActive ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{detailError ?? playbackError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry Short playback"
            onPress={retryPlayback}
            style={styles.retryBtn}
          >
            <Text style={styles.retryBtnText}>Retry playback</Text>
          </Pressable>
        </View>
      ) : null}

      <View
        style={[
          styles.actionsContainer,
          { right: Math.max(14, sideInset), bottom: compactLayout ? 20 : 88, gap: compactLayout ? 8 : 16 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={reaction === 'liked' ? 'Unlike this Short' : 'Like this Short'}
          onPress={() => void toggleLike()}
          disabled={isUpdatingReaction}
          style={[styles.actionBtn, reaction === 'liked' && styles.actionBtnActive]}
        >
          <Text style={styles.actionIcon}>{reaction === 'liked' ? '♥' : '♡'}</Text>
          <Text style={styles.actionLabel}>
            {reaction === 'liked' ? 'Liked' : 'Like'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Comments and Details"
          onPress={() => router.push({ pathname: '/watch/[id]', params: { id: video.id } })}
          style={styles.actionBtn}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionLabel}>Details</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
          onPress={toggleMute}
          style={styles.actionBtn}
        >
          <Text style={styles.actionIcon}>{isMuted ? '🔇' : '🔊'}</Text>
          <Text style={styles.actionLabel}>{isMuted ? 'Muted' : 'Sound'}</Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.bottomOverlay,
          { left: Math.max(14, sideInset), right: Math.max(76, sideInset + 64), bottom: compactLayout ? 14 : 24 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View channel ${video.channel.name}`}
          onPress={() => router.push({
            pathname: '/channel/[handle]',
            params: { handle: displayHandle },
          })}
          style={styles.creatorRow}
        >
          {video.channel.avatarUrl ? (
            <Image source={{ uri: video.channel.avatarUrl }} style={styles.creatorAvatar} />
          ) : (
            <View style={[styles.creatorAvatar, styles.creatorAvatarEmpty]} />
          )}
          <View>
            <View style={styles.nameVerifiedRow}>
              <Text style={styles.creatorName}>{video.channel.name}</Text>
              {video.channel.isVerified ? <Text style={styles.verified}>✓</Text> : null}
            </View>
            <Text style={styles.creatorHandle}>{displayHandle}</Text>
          </View>
        </Pressable>

        <Text numberOfLines={2} style={styles.videoTitle}>{video.title}</Text>
        <Text style={styles.viewCount}>{formatViewCount(video.viewsCount)}</Text>
        {reactionError ? <Text style={styles.reactionError}>{reactionError}</Text> : null}
      </View>
    </View>
  );
}

export default function ShortsScreen() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');

  const tabHeight = 54 + insets.bottom;
  const itemHeight = Math.max(240, height - tabHeight);

  const feed = useVideoFeed('/feed/shorts');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pausedVideoId, setPausedVideoId] = useState<string | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  const onViewableItemsChanged = useCallback<NonNullable<FlatListProps<ViewerVideo>['onViewableItemsChanged']>>(({ viewableItems }) => {
    if (viewableItems.length > 0 && typeof viewableItems[0].index === 'number') {
      setActiveIndex(viewableItems[0].index);
      setPausedVideoId(null);
    }
  }, []);

  if (feed.isLoading && feed.videos.length === 0) {
    return (
      <SafeAreaView style={styles.fill} edges={['top']}>
        <LoadingState label="Loading Shorts…" />
      </SafeAreaView>
    );
  }

  if (feed.error && feed.videos.length === 0) {
    return (
      <SafeAreaView style={styles.fill} edges={['top']}>
        <ErrorState
          title="Shorts unavailable"
          message={feed.error}
          onRetry={feed.retry}
        />
      </SafeAreaView>
    );
  }

  if (feed.videos.length === 0) {
    return (
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.center}>
          <EmptyState
            title="No Shorts yet"
            message="Short portrait videos published by creators will appear here."
          />
          <Pressable
            accessibilityRole="button"
            onPress={feed.retry}
            style={styles.retryBtn}
          >
            <Text style={styles.retryBtnText}>Refresh</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <FlatList
        data={feed.videos}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ShortItem
            video={item}
            isActive={index === activeIndex}
            isNearActive={Math.abs(index - activeIndex) <= 1}
            isFocused={isFocused}
            appIsActive={appIsActive}
            isPausedByUser={pausedVideoId === item.id}
            onTogglePause={() => setPausedVideoId((current) => (current === item.id ? null : item.id))}
            height={itemHeight}
            sideInset={Math.max(insets.left, insets.right)}
          />
        )}
        getItemLayout={(_data, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={SHORTS_VIEWABILITY_CONFIG}
        onEndReached={feed.hasMore && !feed.isLoadingMore ? feed.loadMore : undefined}
        onEndReachedThreshold={0.5}
        refreshing={feed.isLoading}
        onRefresh={feed.retry}
        ListFooterComponent={feed.isLoadingMore || feed.moreError ? (
          <View style={styles.loadingMore}>
            {feed.isLoadingMore ? <ActivityIndicator color={colors.accent} /> : null}
            {feed.moreError ? (
              <View style={styles.footerError}>
                <Text style={styles.errorText}>{feed.moreError}</Text>
                <Pressable accessibilityRole="button" onPress={feed.loadMore} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  shortContainer: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  placeholderBg: { backgroundColor: colors.surfaceRaised },
  gradientOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedPill: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pausedPillText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 24,
    gap: 12,
  },
  errorText: { color: colors.text, fontSize: 14, textAlign: 'center', fontWeight: '600' },
  retryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
  },
  retryBtnText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  actionsContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
    minHeight: 52,
  },
  actionBtnActive: { opacity: 0.9 },
  actionIcon: { color: colors.text, fontSize: 26 },
  actionLabel: { color: colors.text, fontSize: 11, fontWeight: '700', marginTop: 3 },
  bottomOverlay: {
    position: 'absolute',
    gap: 8,
  },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  creatorAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceRaised },
  creatorAvatarEmpty: { borderWidth: 1, borderColor: colors.border },
  nameVerifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  creatorName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  verified: { color: colors.accent, fontSize: 12, fontWeight: '900' },
  creatorHandle: { color: colors.muted, fontSize: 12 },
  videoTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  viewCount: { color: colors.muted, fontSize: 12 },
  reactionError: { color: colors.danger, fontSize: 12 },
  loadingMore: { paddingVertical: 18, alignItems: 'center' },
  footerError: { alignItems: 'center', gap: 8, paddingHorizontal: 16 },
});
