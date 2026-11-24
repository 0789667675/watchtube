import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';

export function LoadingState({ label = 'Loading WatchTube…' }: { label?: string }) {
  return (
    <View style={styles.state} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.message}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.state}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ActionButton({
  title,
  onPress,
  disabled = false,
  secondary = false,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (pressed || disabled) && styles.buttonMuted,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
    gap: 10,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  retryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
  },
  secondaryButton: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  secondaryText: { color: colors.text },
  buttonMuted: { opacity: 0.65 },
  pressed: { opacity: 0.75 },
});
