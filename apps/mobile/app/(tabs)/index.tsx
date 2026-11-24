import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthSession } from '@/auth/AuthProvider';
import { ErrorState, EmptyState, LoadingState } from '@/components/ViewerStates';
import { VideoFeedList } from '@/components/VideoFeedList';
import { useVideoFeed } from '@/hooks/useVideoFeed';
import { colors } from '@/theme';

type FeedMode = 'for-you' | 'latest' | 'subscriptions';

export default function HomeScreen() {
  const [mode, setMode] = useState<FeedMode>('for-you');
  const { user, refreshSession } = useAuthSession();
  const router = useRouter();
  const isFeedAvailable = mode !== 'subscriptions' || Boolean(user);
  const feedPath = mode === 'for-you'
    ? '/feed/for-you'
    : mode === 'latest'
      ? '/videos'
      : '/feed/subscriptions';
  const feed = useVideoFeed(
    feedPath,
    isFeedAvailable,
    mode === 'subscriptions' ? refreshSession : undefined,
  );

  const header = (
    <>
      <Text style={styles.heading}>Discover something great</Text>
      <Text style={styles.subtitle}>
        {mode === 'for-you'
          ? 'Recommended videos curated for your taste.'
          : mode === 'latest'
            ? 'Latest public videos from WatchTube creators.'
            : 'Recent public videos from channels you follow.'}
      </Text>
      <View style={styles.filters}>
        {(['for-you', 'latest', 'subscriptions'] as const).map((nextMode) => (
          <Pressable
            key={nextMode}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === nextMode }}
            onPress={() => setMode(nextMode)}
            style={[styles.filter, mode === nextMode && styles.filterSelected]}
          >
            <Text style={[styles.filterText, mode === nextMode && styles.filterTextSelected]}>
              {nextMode === 'for-you' ? 'For You' : nextMode === 'latest' ? 'Latest' : 'Subscriptions'}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.fill} edges={['top']}>
      {mode === 'subscriptions' && !user ? (
        <View style={styles.container}>
          <View style={styles.paddedHeader}>{header}</View>
          <View style={styles.center}>
            <Text style={styles.sectionTitle}>Your subscriptions</Text>
            <EmptyState title="Sign in to see this feed" message="Videos from channels you follow will appear here." />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/account')}
              style={styles.signIn}
            >
              <Text style={styles.signInText}>Go to account</Text>
            </Pressable>
          </View>
        </View>
      ) : feed.isLoading ? (
        <View style={styles.container}>
          <View style={styles.paddedHeader}>{header}</View>
          <LoadingState label="Loading videos…" />
        </View>
      ) : feed.error ? (
        <View style={styles.container}>
          <View style={styles.paddedHeader}>{header}</View>
          <ErrorState message={feed.error} onRetry={feed.retry} />
        </View>
      ) : (
        <VideoFeedList
          videos={feed.videos}
          header={header}
          empty={
            mode === 'for-you'
              ? <EmptyState title="No recommendations yet" message="Watch and react to videos to personalize your For You feed." />
              : mode === 'latest'
                ? <EmptyState title="No videos yet" message="Public videos will appear here when creators publish them." />
                : <EmptyState title="No subscription videos yet" message="New public uploads from channels you follow will appear here." />
          }
          refreshing={feed.isLoading}
          onRefresh={feed.retry}
          hasMore={feed.hasMore}
          onLoadMore={feed.loadMore}
          loadingMore={feed.isLoadingMore}
          moreError={feed.moreError}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  paddedHeader: { paddingHorizontal: 16 },
  heading: { color: colors.text, fontSize: 25, fontWeight: '800', marginTop: 16 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18, marginBottom: 16 },
  filter: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 16,
  },
  filterSelected: { backgroundColor: colors.accentMuted, borderWidth: 1, borderColor: colors.accent },
  filterText: { color: colors.muted, fontWeight: '600' },
  filterTextSelected: { color: colors.text },
  center: { flex: 1, justifyContent: 'center', padding: 24 },
  signIn: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  signInText: { color: colors.accent, fontWeight: '700' },
});
