import { useEffect, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ViewerSearchChannel, ViewerVideo } from '@watchtube/types';
import { apiGet, getApiErrorMessage } from '@/api/client';
import { parseSearchPage } from '@/api/contracts';
import { ActionButton, EmptyState, ErrorState, LoadingState } from '@/components/ViewerStates';
import { VideoFeedList } from '@/components/VideoFeedList';
import { colors } from '@/theme';
import { formatChannelHandle } from '@/utils/format';

interface SearchResult {
  key: string;
  page: number;
  videos: ViewerVideo[];
  channels: ViewerSearchChannel[];
  hasMore: boolean;
  error: string | null;
}

function SearchChannelCard({ channel }: { channel: ViewerSearchChannel }) {
  const router = useRouter();
  const displayHandle = formatChannelHandle(channel.handle);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View channel ${channel.name}`}
      onPress={() => router.push({
        pathname: '/channel/[handle]',
        params: { handle: displayHandle },
      })}
      style={({ pressed }) => [styles.channelCard, pressed && styles.cardPressed]}
    >
      {channel.avatarUrl ? (
        <Image source={{ uri: channel.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty]} />
      )}
      <View style={styles.channelDetails}>
        <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
        <Text numberOfLines={1} style={styles.channelHandle}>{displayHandle}</Text>
        <Text style={styles.channelHandle}>{new Intl.NumberFormat().format(channel.subscriberCount)} subscribers</Text>
      </View>
    </Pressable>
  );
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [result, setResult] = useState<SearchResult>();
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [moreErrorResult, setMoreErrorResult] = useState<{ key: string; message: string }>();
  const [retryNumber, setRetryNumber] = useState(0);
  const requestKey = `${submittedQuery}:${retryNumber}`;
  const resultIsCurrent = result?.key === requestKey;
  const videos = resultIsCurrent ? result.videos : [];
  const channels = resultIsCurrent ? result.channels : [];
  const hasMore = resultIsCurrent && result.hasMore;
  const isLoading = Boolean(submittedQuery) && !resultIsCurrent;
  const isLoadingMore = loadingMoreKey === requestKey;
  const error = resultIsCurrent ? result.error : null;
  const moreError = moreErrorResult?.key === requestKey ? moreErrorResult.message : null;

  useEffect(() => {
    if (!submittedQuery) return;

    const controller = new AbortController();
    apiGet<unknown>('/feed/search', {
      q: submittedQuery,
      page: 1,
      limit: 12,
    }, controller.signal)
      .then((data) => {
        const response = parseSearchPage(data);
        setResult({
          key: requestKey,
          page: 1,
          videos: response.videos,
          channels: response.channels,
          hasMore: response.hasMoreVideos || response.hasMoreChannels,
          error: null,
        });
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            page: 1,
            videos: [],
            channels: [],
            hasMore: false,
            error: getApiErrorMessage(requestError, 'Please try your search again.'),
          });
        }
      });

    return () => controller.abort();
  }, [requestKey, submittedQuery]);

  const submitSearch = () => {
    const normalized = query.trim();
    Keyboard.dismiss();
    setSubmittedQuery(normalized);
    if (normalized === submittedQuery) setRetryNumber((current) => current + 1);
  };

  const loadMore = async () => {
    if (isLoading || isLoadingMore || !resultIsCurrent || !hasMore || !submittedQuery || !result) return;
    const nextPage = result.page + 1;
    setLoadingMoreKey(requestKey);
    setMoreErrorResult(undefined);
    try {
      const data = await apiGet<unknown>('/feed/search', {
        q: submittedQuery,
        page: nextPage,
        limit: 12,
      });
      const response = parseSearchPage(data);
      setResult((current) => current?.key === requestKey
        ? {
          ...current,
          page: nextPage,
          videos: [...current.videos, ...response.videos],
          channels: [...current.channels, ...response.channels],
          hasMore: response.hasMoreVideos || response.hasMoreChannels,
        }
        : current);
    } catch (requestError) {
      setMoreErrorResult({
        key: requestKey,
        message: getApiErrorMessage(requestError, 'More search results could not be loaded.'),
      });
    } finally {
      setLoadingMoreKey((current) => current === requestKey ? null : current);
    }
  };

  const searchHeader = submittedQuery ? (
    <View>
      {channels.length ? (
        <>
          <Text style={styles.sectionTitle}>Channels and creators</Text>
          {channels.map((channel) => <SearchChannelCard key={channel.id} channel={channel} />)}
        </>
      ) : null}
      <Text style={styles.sectionTitle}>Videos</Text>
    </View>
  ) : (
    <EmptyState title="Search WatchTube" message="Search public videos and creators by name, title, or topic." />
  );

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={styles.searchArea}>
          <Text style={styles.heading}>Search</Text>
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel="Search videos and channels"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={submitSearch}
              placeholder="Videos, creators, topics"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={100}
              style={styles.input}
            />
            <ActionButton title="Search" onPress={submitSearch} />
          </View>
        </View>

        {isLoading ? (
          <LoadingState label="Searching videos and channels…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryNumber((current) => current + 1)} />
        ) : submittedQuery && !videos.length && !channels.length ? (
          <EmptyState title="No results found" message={`No public videos or channels match “${submittedQuery}”.`} />
        ) : (
          <VideoFeedList
            videos={videos}
            header={searchHeader}
            empty={submittedQuery ? <Text style={styles.noVideos}>No matching public videos on this page.</Text> : undefined}
            refreshing={isLoading}
            onRefresh={submittedQuery ? () => setRetryNumber((current) => current + 1) : undefined}
            hasMore={hasMore}
            onLoadMore={loadMore}
            loadingMore={isLoadingMore}
            moreError={moreError}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  searchArea: { paddingHorizontal: 16, paddingBottom: 8 },
  heading: { color: colors.text, fontSize: 25, fontWeight: '800', marginTop: 16, marginBottom: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
  },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 18, marginBottom: 10 },
  channelCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 12,
    marginBottom: 8,
  },
  cardPressed: { opacity: 0.8 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceRaised },
  avatarEmpty: { borderWidth: 1, borderColor: colors.border },
  channelDetails: { flex: 1, minWidth: 0 },
  channelName: { color: colors.text, fontWeight: '700', fontSize: 14 },
  channelHandle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  noVideos: { color: colors.muted, paddingVertical: 8 },
});
