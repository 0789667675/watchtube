import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorState, EmptyState, LoadingState } from '@/components/ViewerStates';
import { VideoFeedList } from '@/components/VideoFeedList';
import { useVideoFeed } from '@/hooks/useVideoFeed';
import { colors } from '@/theme';

export default function TrendingScreen() {
  const feed = useVideoFeed('/feed/trending');

  if (feed.isLoading) return <SafeAreaView style={styles.fill} edges={['top']}><LoadingState label="Loading trending videos…" /></SafeAreaView>;
  if (feed.error) return <SafeAreaView style={styles.fill} edges={['top']}><ErrorState message={feed.error} onRetry={feed.retry} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.fill} edges={['top']}>
      <VideoFeedList
        videos={feed.videos}
        header={(
          <>
            <Text style={styles.heading}>Trending</Text>
            <Text style={styles.subtitle}>Public videos ranked by recorded views and comment activity.</Text>
          </>
        )}
        empty={<EmptyState title="Nothing trending yet" message="Public videos need recorded views, likes, or comments to appear here." />}
        refreshing={feed.isLoading}
        onRefresh={feed.retry}
        hasMore={feed.hasMore}
        onLoadMore={feed.loadMore}
        loadingMore={feed.isLoadingMore}
        moreError={feed.moreError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  heading: { color: colors.text, fontSize: 25, fontWeight: '800', marginTop: 16 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 18 },
});
