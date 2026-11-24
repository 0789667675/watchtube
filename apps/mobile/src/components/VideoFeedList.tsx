import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ViewerVideo } from '@watchtube/types';
import { colors } from '@/theme';
import { VideoCard } from '@/components/VideoCard';

export function VideoFeedList({
  videos,
  header,
  empty,
  refreshing = false,
  onRefresh,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  moreError,
}: {
  videos: ViewerVideo[];
  header?: ReactNode;
  empty?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  moreError?: string | null;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = Math.max(0, width - insets.left - insets.right);
  const columns = availableWidth >= 1100 ? 3 : availableWidth >= 680 ? 2 : 1;

  return (
    <FlatList
      key={columns}
      data={videos}
      keyExtractor={(video) => video.id}
      renderItem={({ item }) => <VideoCard video={item} />}
      numColumns={columns}
      ListHeaderComponent={header ? <View style={styles.header}>{header}</View> : undefined}
      ListEmptyComponent={empty ? <View style={styles.empty}>{empty}</View> : undefined}
      ListFooterComponent={(
        <View style={styles.footer}>
          {loadingMore ? <ActivityIndicator color={colors.accent} /> : null}
          {moreError ? <Text style={styles.error}>{moreError}</Text> : null}
          {hasMore && !loadingMore && onLoadMore ? (
            <Pressable
              accessibilityRole="button"
              onPress={onLoadMore}
              style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
            >
              <Text style={styles.loadMoreText}>Load more</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      contentContainerStyle={[
        styles.list,
        {
          paddingLeft: Math.max(10, insets.left),
          paddingRight: Math.max(10, insets.right),
        },
      ]}
      columnWrapperStyle={columns > 1 ? styles.row : undefined}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.4}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 24, flexGrow: 1 },
  row: { gap: 8 },
  header: { paddingHorizontal: 6 },
  empty: { flex: 1, justifyContent: 'center' },
  footer: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  loadMore: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 20,
  },
  loadMoreText: { color: colors.text, fontWeight: '700' },
  error: { color: colors.danger, textAlign: 'center', paddingHorizontal: 16 },
  pressed: { opacity: 0.75 },
});
