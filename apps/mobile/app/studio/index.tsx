import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiGet, getApiErrorMessage, isUnauthorizedError } from '@/api/client';
import { parseCreatorVideos, type CreatorVideoSummary } from '@/api/contracts';
import { useAuthSession } from '@/auth/AuthProvider';
import { ActionButton, EmptyState, ErrorState, LoadingState } from '@/components/ViewerStates';
import { colors } from '@/theme';
import { formatChannelHandle, formatPublishedDate, formatViewCount } from '@/utils/format';
import { goBackOrHome } from '@/utils/navigation';

function StatusBadge({ status }: { status: CreatorVideoSummary['status'] }) {
  let badgeStyle = styles.badgeDraft;
  let textStyle = styles.badgeTextDraft;

  if (status === 'PUBLISHED' || status === 'READY') {
    badgeStyle = styles.badgePublished;
    textStyle = styles.badgeTextPublished;
  } else if (status === 'PROCESSING' || status === 'UPLOADING' || status === 'UPLOADED' || status === 'READY_FOR_REVIEW') {
    badgeStyle = styles.badgeProcessing;
    textStyle = styles.badgeTextProcessing;
  } else if (status === 'FAILED' || status === 'BLOCKED' || status === 'REJECTED') {
    badgeStyle = styles.badgeFailed;
    textStyle = styles.badgeTextFailed;
  }

  return (
    <View style={[styles.badge, badgeStyle]}>
      <Text style={[styles.badgeText, textStyle]}>{status.replaceAll('_', ' ')}</Text>
    </View>
  );
}

function getActionHint(status: CreatorVideoSummary['status']): string | null {
  switch (status) {
    case 'DRAFT':
      return 'Tap to select video & upload';
    case 'UPLOADING':
      return 'Tap to resume upload';
    case 'UPLOADED':
      return 'Tap to verify & start processing';
    case 'PROCESSING':
      return 'Tap to check processing status';
    case 'READY_FOR_REVIEW':
      return 'Ready to publish · Tap to review';
    case 'FAILED':
      return 'Upload or processing failed · Tap to retry';
    default:
      return null;
  }
}

function CreatorVideoRow({ video }: { video: CreatorVideoSummary }) {
  const router = useRouter();
  const isWatchable = video.status === 'PUBLISHED' || video.status === 'READY';
  const publishedDate = formatPublishedDate(video.createdAt, video.createdAt);
  const actionHint = getActionHint(video.status);

  const openManage = () => {
    router.push({ pathname: '/studio/upload', params: { videoId: video.id } });
  };

  return (
    <View style={styles.videoRowContainer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Video ${video.title}, status ${video.status}`}
        onPress={() => {
          if (isWatchable) {
            router.push({ pathname: '/watch/[id]', params: { id: video.id } });
          } else {
            openManage();
          }
        }}
        style={({ pressed }) => [styles.videoRow, pressed && styles.rowPressed]}
      >
        <View style={styles.thumbnail}>
          {video.thumbnailUrl ? (
            <Image source={{ uri: video.thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholderThumb]} />
          )}
          {video.isShort ? (
            <View style={styles.shortsTag}>
              <Text style={styles.shortsTagText}>Short</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.videoDetails}>
          <Text numberOfLines={2} style={styles.videoTitle}>{video.title}</Text>
          <View style={styles.badgeRow}>
            <StatusBadge status={video.status} />
            <View style={styles.badgeNeutral}>
              <Text style={styles.badgeTextNeutral}>{video.visibility}</Text>
            </View>
          </View>
          <Text style={styles.videoMeta}>
            {formatViewCount(video.viewsCount)}{publishedDate ? ` · ${publishedDate}` : ''}
          </Text>
          {actionHint ? <Text style={styles.actionHint}>{actionHint}</Text> : null}
        </View>
      </Pressable>
      {isWatchable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${video.title}`}
          onPress={openManage}
          style={({ pressed }) => [styles.manageBtn, pressed && styles.rowPressed]}
        >
          <Text style={styles.manageBtnText}>Manage</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function StudioScreen() {
  const router = useRouter();
  const { user, refreshSession } = useAuthSession();
  const [videos, setVideos] = useState<CreatorVideoSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const channel = user?.channels?.[0];

  const loadVideos = useCallback(() => {
    if (!user) return () => {};
    let active = true;
    const controller = new AbortController();

    apiGet<unknown>('/videos/mine', undefined, controller.signal)
      .then((data) => {
        if (active) {
          setVideos(parseCreatorVideos(data));
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) {
          if (isUnauthorizedError(err)) {
            void refreshSession();
          }
          setError(getApiErrorMessage(err, 'Failed to load your studio videos.'));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshSession, user]);

  useFocusEffect(
    useCallback(() => {
      return loadVideos();
    }, [loadVideos]),
  );

  const handleRefresh = () => {
    setIsLoading(true);
    setError(null);
    setRefreshCount((c) => c + 1);
  };

  useEffect(() => {
    if (refreshCount === 0) return;
    return loadVideos();
  }, [loadVideos, refreshCount]);

  if (!user) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        <Pressable accessibilityRole="button" onPress={() => goBackOrHome(router)} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <EmptyState
          title="Sign in required"
          message="Sign in to your WatchTube creator account to access Creator Studio."
        />
        <View style={styles.centerBtn}>
          <ActionButton title="Go to Account" onPress={() => router.push('/account')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.topNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => goBackOrHome(router)}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.navTitle}>Creator Studio</Text>
        <View style={styles.navPlaceholder} />
      </View>

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CreatorVideoRow video={item} />}
        refreshing={isLoading}
        onRefresh={handleRefresh}
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.channelCard}>
              <View style={styles.channelMeta}>
                <Text style={styles.channelName}>{channel?.name ?? 'Your Channel'}</Text>
                <Text style={styles.channelHandle}>
                  {channel ? formatChannelHandle(channel.handle) : user.email}
                </Text>
              </View>
              <ActionButton
                title="+ Upload Video"
                onPress={() => router.push('/studio/upload')}
              />
            </View>
            <Text style={styles.sectionHeading}>Your Uploads ({videos.length})</Text>
            {error && videos.length > 0 ? (
              <Text style={styles.inlineError}>{error}</Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <LoadingState label="Loading studio uploads…" />
          ) : error ? (
            <ErrorState message={error} onRetry={handleRefresh} />
          ) : (
            <EmptyState
              title="No videos yet"
              message="Upload standard videos or Shorts to grow your audience on WatchTube."
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
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
  header: { padding: 16, gap: 16 },
  channelCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 14,
  },
  channelMeta: { gap: 4 },
  channelName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  channelHandle: { color: colors.muted, fontSize: 13 },
  sectionHeading: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 4 },
  inlineError: { color: colors.danger, fontSize: 13 },
  listContent: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingBottom: 32 },
  videoRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingRight: 12,
  },
  videoRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowPressed: { opacity: 0.8 },
  thumbnail: {
    width: 110,
    height: 68,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  placeholderThumb: { backgroundColor: colors.surfaceRaised },
  shortsTag: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: colors.accent,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  shortsTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  videoDetails: { flex: 1, justifyContent: 'center', gap: 5 },
  videoTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 18 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgePublished: { backgroundColor: '#133926' },
  badgeTextPublished: { color: colors.success },
  badgeProcessing: { backgroundColor: '#382D12' },
  badgeTextProcessing: { color: '#F5C542' },
  badgeDraft: { backgroundColor: colors.surfaceRaised },
  badgeTextDraft: { color: colors.muted },
  badgeFailed: { backgroundColor: '#3B1B1D' },
  badgeTextFailed: { color: colors.danger },
  badgeNeutral: { backgroundColor: colors.surfaceRaised, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTextNeutral: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  videoMeta: { color: colors.muted, fontSize: 12 },
  actionHint: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  manageBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manageBtnText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  centerBtn: { alignItems: 'center', marginTop: 12 },
});
