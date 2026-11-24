import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiGet, apiPost, getApiErrorMessage, isUnauthorizedError } from '@/api/client';
import {
  parseChannelProfile,
  parseSubscription,
  type ChannelProfile,
} from '@/api/contracts';
import { useAuthSession } from '@/auth/AuthProvider';
import { VideoFeedList } from '@/components/VideoFeedList';
import { ActionButton, EmptyState, ErrorState, LoadingState } from '@/components/ViewerStates';
import { colors } from '@/theme';
import { formatChannelHandle } from '@/utils/format';
import { goBackOrHome } from '@/utils/navigation';

interface ChannelResult {
  key: string;
  channel?: ChannelProfile;
  error?: string;
}

interface SubscriptionState {
  key: string;
  isSubscribed: boolean | null;
}

export default function ChannelProfileScreen() {
  const { handle: routeHandle } = useLocalSearchParams<{ handle: string | string[] }>();
  const rawHandle = Array.isArray(routeHandle) ? routeHandle[0] : routeHandle;
  const normalizedHandle = formatChannelHandle(rawHandle);
  const router = useRouter();
  const { user, refreshSession } = useAuthSession();

  const [channelResult, setChannelResult] = useState<ChannelResult>();
  const [retryCount, setRetryCount] = useState(0);
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>();
  const [isUpdatingSub, setIsUpdatingSub] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failedBannerUrl, setFailedBannerUrl] = useState<string | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);

  const channelRequestKey = `${normalizedHandle}:${retryCount}`;
  const channelResultIsCurrent = channelResult?.key === channelRequestKey;
  const channel = channelResultIsCurrent ? channelResult.channel ?? null : null;
  const error = !normalizedHandle
    ? 'This channel link is invalid.'
    : channelResultIsCurrent
      ? channelResult.error ?? null
      : null;
  const isLoading = Boolean(normalizedHandle) && !channelResultIsCurrent;

  const subscriptionKey = `${user?.id ?? ''}:${channel?.id ?? ''}`;
  const subStateIsCurrent = subscriptionState?.key === subscriptionKey;
  const isSubscribed = user && subStateIsCurrent ? subscriptionState.isSubscribed : null;

  useEffect(() => {
    if (!normalizedHandle) return;
    const controller = new AbortController();
    apiGet<unknown>(`/channels/${encodeURIComponent(normalizedHandle)}`, undefined, controller.signal)
      .then((data) => {
        setChannelResult({ key: channelRequestKey, channel: parseChannelProfile(data) });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setChannelResult({
            key: channelRequestKey,
            error: getApiErrorMessage(err, 'This channel could not be loaded.'),
          });
        }
      });

    return () => controller.abort();
  }, [channelRequestKey, normalizedHandle]);

  useEffect(() => {
    if (!user || !channel?.id) return;
    const controller = new AbortController();
    apiGet<unknown>(
      `/channels/${encodeURIComponent(channel.id)}/subscription-status`,
      undefined,
      controller.signal,
    )
      .then((subData) => {
        setSubscriptionState({ key: subscriptionKey, isSubscribed: parseSubscription(subData) });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          if (isUnauthorizedError(err)) {
            void refreshSession();
          } else {
            setSubscriptionState({ key: subscriptionKey, isSubscribed: null });
          }
        }
      });

    return () => controller.abort();
  }, [channel?.id, refreshSession, subscriptionKey, user]);

  const toggleSubscription = async () => {
    if (!user) {
      router.push('/account');
      return;
    }
    if (!channel) return;
    setActionError(null);
    setIsUpdatingSub(true);
    try {
      const res = await apiPost<unknown>(`/channels/${encodeURIComponent(channel.id)}/subscribe`);
      const nextSubState = parseSubscription(res);
      setSubscriptionState({ key: subscriptionKey, isSubscribed: nextSubState });
      setChannelResult((current) => {
        if (current?.key !== channelRequestKey || !current.channel) return current;
        const delta = nextSubState ? 1 : -1;
        return {
          ...current,
          channel: {
            ...current.channel,
            subscriberCount: Math.max(0, current.channel.subscriberCount + delta),
          },
        };
      });
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        await refreshSession();
        router.push('/account');
      } else {
        setActionError(getApiErrorMessage(err, 'Subscription could not be updated.'));
      }
    } finally {
      setIsUpdatingSub(false);
    }
  };

  const backHeader = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={() => goBackOrHome(router)}
      style={styles.back}
    >
      <Text style={styles.backText}>‹ Back</Text>
    </Pressable>
  );

  if (isLoading && !channel) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        {backHeader}
        <LoadingState label="Loading channel profile…" />
      </SafeAreaView>
    );
  }

  if (error || !channel) {
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
        {backHeader}
        <ErrorState
          title="Channel unavailable"
          message={error ?? 'This channel could not be found.'}
          onRetry={normalizedHandle ? () => setRetryCount((c) => c + 1) : undefined}
        />
      </SafeAreaView>
    );
  }

  const showBanner = Boolean(channel.bannerUrl && failedBannerUrl !== channel.bannerUrl);
  const showAvatar = Boolean(channel.avatarUrl && failedAvatarUrl !== channel.avatarUrl);

  const profileHeader = (
    <View style={styles.profileHeader}>
      {showBanner && channel.bannerUrl ? (
        <Image
          source={{ uri: channel.bannerUrl }}
          style={styles.banner}
          resizeMode="cover"
          onError={() => setFailedBannerUrl(channel.bannerUrl)}
        />
      ) : (
        <View style={[styles.banner, styles.bannerEmpty]} />
      )}

      <View style={styles.header}>
        <View style={styles.avatarRow}>
          {showAvatar && channel.avatarUrl ? (
            <Image
              source={{ uri: channel.avatarUrl }}
              style={styles.avatar}
              onError={() => setFailedAvatarUrl(channel.avatarUrl)}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Text style={styles.avatarFallback}>
                {channel.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.headerDetails}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{channel.name}</Text>
              {channel.isVerified ? <Text style={styles.verifiedBadge}>✓</Text> : null}
            </View>
            <Text style={styles.handle}>{formatChannelHandle(channel.handle)}</Text>
            <Text style={styles.subCount}>
              {new Intl.NumberFormat().format(channel.subscriberCount)} subscribers
            </Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <ActionButton
            title={isUpdatingSub ? 'Updating…' : isSubscribed ? 'Subscribed' : 'Subscribe'}
            onPress={() => void toggleSubscription()}
            disabled={isUpdatingSub}
            secondary={Boolean(isSubscribed)}
          />
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        </View>

        {channel.description ? (
          <Text style={styles.description}>{channel.description}</Text>
        ) : null}
      </View>

      <Text style={styles.sectionHeading}>Videos ({channel.videos.length})</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
      {backHeader}
      <VideoFeedList
        videos={channel.videos}
        header={profileHeader}
        empty={
          <EmptyState
            title="No uploads yet"
            message="This channel hasn't published any public videos."
          />
        }
        refreshing={isLoading}
        onRefresh={() => setRetryCount((c) => c + 1)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  backText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  profileHeader: { marginBottom: 4 },
  banner: { width: '100%', height: 120, borderRadius: 12, backgroundColor: colors.surfaceRaised },
  bannerEmpty: { backgroundColor: colors.surface },
  header: { paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmpty: { borderWidth: 1, borderColor: colors.border },
  avatarFallback: { color: colors.text, fontSize: 24, fontWeight: '800' },
  headerDetails: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  verifiedBadge: { color: colors.accent, fontSize: 14, fontWeight: '900' },
  handle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  subCount: { color: colors.muted, fontSize: 13, marginTop: 2 },
  actionRow: { marginTop: 14, gap: 8 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  description: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 12 },
  sectionHeading: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 12 },
});
