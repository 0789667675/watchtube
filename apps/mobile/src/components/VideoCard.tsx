import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { ViewerVideo } from '@watchtube/types';
import { colors } from '@/theme';
import { formatChannelHandle, formatDuration, formatPublishedDate, formatViewCount } from '@/utils/format';

export function VideoCard({ video }: { video: ViewerVideo }) {
  const router = useRouter();
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
  const imageFailed = Boolean(video.thumbnailUrl && failedThumbnailUrl === video.thumbnailUrl);
  const duration = formatDuration(video.duration);
  const published = formatPublishedDate(video.publishedAt, video.createdAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Watch ${video.title} by ${video.channel.name}`}
      onPress={() => router.push({ pathname: '/watch/[id]', params: { id: video.id } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.thumbnail}>
        {video.thumbnailUrl && !imageFailed ? (
          <Image
            source={{ uri: video.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setFailedThumbnailUrl(video.thumbnailUrl ?? null)}
          />
        ) : null}
        {duration ? (
          <Text style={styles.duration}>{duration}</Text>
        ) : null}
      </View>
      <View style={styles.details}>
        <Text numberOfLines={2} style={styles.title}>{video.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go to ${video.channel.name}'s channel`}
          onPress={(event) => {
            event.stopPropagation();
            router.push({
              pathname: '/channel/[handle]',
              params: { handle: formatChannelHandle(video.channel.handle) },
            });
          }}
          hitSlop={8}
          style={styles.channelButton}
        >
          <Text numberOfLines={1} style={styles.channel}>{video.channel.name}</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.meta}>
          {formatViewCount(video.viewsCount)}{published ? ` · ${published}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, marginHorizontal: 6, marginBottom: 20 },
  pressed: { opacity: 0.8 },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
  },
  duration: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    overflow: 'hidden',
    borderRadius: 5,
    backgroundColor: '#101116D9',
    color: colors.text,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
  },
  details: { paddingTop: 10, paddingHorizontal: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  channelButton: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center', marginTop: 2 },
  channel: { color: colors.muted, fontSize: 13 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
