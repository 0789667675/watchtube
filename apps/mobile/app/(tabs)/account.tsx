import { useRef, useState, type ComponentRef } from 'react';
import {
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthSession } from '@/auth/AuthProvider';
import { ActionButton, ErrorState, LoadingState } from '@/components/ViewerStates';
import { colors } from '@/theme';
import { formatChannelHandle } from '@/utils/format';

type AuthTab = 'signin' | 'register';

export default function AccountScreen() {
  const router = useRouter();
  const {
    user,
    isCheckingSession,
    sessionError,
    refreshSession,
    signIn,
    register,
    createChannel,
    signOut,
  } = useAuthSession();

  const [authTab, setAuthTab] = useState<AuthTab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelHandle, setChannelHandle] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelError, setChannelError] = useState<string | null>(null);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const passwordInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmPasswordInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const handleInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const descriptionInputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const submitAuth = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    if (authTab === 'register') {
      if (password.length < 8) {
        setFormError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setFormError('Passwords do not match.');
        return;
      }
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      if (authTab === 'signin') {
        await signIn(trimmedEmail, password);
      } else {
        await register(trimmedEmail, password);
      }
      setPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitCreateChannel = async () => {
    const trimmedName = channelName.trim();
    const trimmedHandle = channelHandle.trim();
    if (!trimmedName || !trimmedHandle) {
      setChannelError('Channel name and handle are required.');
      return;
    }
    const normalizedHandle = trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`;
    if (!/^@[a-zA-Z0-9_]{1,30}$/.test(normalizedHandle)) {
      setChannelError('Handle must be 1–30 letters, numbers, or underscores.');
      return;
    }
    setChannelError(null);
    setIsCreatingChannel(true);
    try {
      await createChannel({
        name: trimmedName,
        handle: normalizedHandle,
        description: channelDescription.trim() || undefined,
      });
      setShowCreateChannel(false);
      setChannelName('');
      setChannelHandle('');
      setChannelDescription('');
    } catch (err: unknown) {
      setChannelError(err instanceof Error ? err.message : 'Channel creation failed.');
    } finally {
      setIsCreatingChannel(false);
    }
  };

  const logout = async () => {
    setFormError(null);
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : 'Sign-out failed. Your session has not been cleared.',
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const channels = user?.channels ?? [];
  const primaryChannel = channels[0];

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isCheckingSession && Boolean(user)}
              onRefresh={() => void refreshSession()}
              tintColor={colors.accent}
            />
          }
        >
          <View style={styles.inner}>
            <Text style={styles.heading}>Account</Text>
            <Text style={styles.subtitle}>
              Manage your WatchTube identity, channel, and creator studio.
            </Text>

            {isCheckingSession && !user ? (
              <LoadingState label="Checking your session…" />
            ) : user ? (
              <View style={styles.container}>
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.status}>Signed in</Text>
                    {user.role && user.role !== 'USER' ? (
                      <View style={styles.roleBadge}>
                        <Text style={styles.roleText}>{user.role}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.email}>{user.email}</Text>
                  {formError ? <Text style={styles.error}>{formError}</Text> : null}
                  <ActionButton
                    title={isSigningOut ? 'Signing out…' : 'Sign out'}
                    onPress={() => void logout()}
                    disabled={isSigningOut}
                    secondary
                  />
                </View>

                {primaryChannel ? (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Your Channel</Text>
                    <View style={styles.channelRow}>
                      {primaryChannel.avatarUrl && !avatarFailed ? (
                        <Image
                          source={{ uri: primaryChannel.avatarUrl }}
                          style={styles.avatarImage}
                          onError={() => setAvatarFailed(true)}
                        />
                      ) : (
                        <View style={styles.avatar}>
                          <Text style={styles.avatarLetter}>
                            {primaryChannel.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.channelMeta}>
                        <Text style={styles.channelName}>{primaryChannel.name}</Text>
                        <Text style={styles.channelHandle}>
                          {formatChannelHandle(primaryChannel.handle)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.channelActions}>
                      <ActionButton
                        title="Open Creator Studio"
                        onPress={() => router.push('/studio')}
                      />
                      <ActionButton
                        title="View Public Channel"
                        onPress={() => router.push({
                          pathname: '/channel/[handle]',
                          params: { handle: formatChannelHandle(primaryChannel.handle) },
                        })}
                        secondary
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Creator Channel</Text>
                    <Text style={styles.mutedText}>
                      You haven’t set up a creator channel yet. Create one to upload videos and Shorts.
                    </Text>
                    {showCreateChannel ? (
                      <View style={styles.formGap}>
                        <TextInput
                          accessibilityLabel="Channel Name"
                          value={channelName}
                          onChangeText={setChannelName}
                          placeholder="Channel Name (e.g. Maya Tech)"
                          placeholderTextColor={colors.muted}
                          maxLength={80}
                          returnKeyType="next"
                          onSubmitEditing={() => handleInputRef.current?.focus()}
                          style={styles.input}
                        />
                        <TextInput
                          ref={handleInputRef}
                          accessibilityLabel="Channel Handle"
                          value={channelHandle}
                          onChangeText={setChannelHandle}
                          placeholder="Handle (e.g. @mayatech)"
                          placeholderTextColor={colors.muted}
                          autoCapitalize="none"
                          autoCorrect={false}
                          maxLength={31}
                          returnKeyType="next"
                          onSubmitEditing={() => descriptionInputRef.current?.focus()}
                          style={styles.input}
                        />
                        <Text style={styles.hint}>
                          Use 1–30 letters, numbers, or underscores.
                        </Text>
                        <TextInput
                          ref={descriptionInputRef}
                          accessibilityLabel="Channel Description"
                          value={channelDescription}
                          onChangeText={setChannelDescription}
                          placeholder="Description (optional)"
                          placeholderTextColor={colors.muted}
                          maxLength={1000}
                          multiline
                          style={[styles.input, styles.multiline]}
                        />
                        {channelError ? <Text style={styles.error}>{channelError}</Text> : null}
                        <ActionButton
                          title={isCreatingChannel ? 'Creating…' : 'Create Channel'}
                          onPress={() => void submitCreateChannel()}
                          disabled={isCreatingChannel}
                        />
                        <ActionButton
                          title="Cancel"
                          onPress={() => {
                            setShowCreateChannel(false);
                            setChannelError(null);
                          }}
                          disabled={isCreatingChannel}
                          secondary
                        />
                      </View>
                    ) : (
                      <ActionButton
                        title="Create Channel"
                        onPress={() => {
                          setChannelError(null);
                          setShowCreateChannel(true);
                        }}
                      />
                    )}
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.card}>
                <View style={styles.tabRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: authTab === 'signin' }}
                    onPress={() => {
                      setAuthTab('signin');
                      setFormError(null);
                      setConfirmPassword('');
                    }}
                    style={[styles.tab, authTab === 'signin' && styles.tabSelected]}
                  >
                    <Text style={[styles.tabText, authTab === 'signin' && styles.tabTextSelected]}>
                      Sign in
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: authTab === 'register' }}
                    onPress={() => {
                      setAuthTab('register');
                      setFormError(null);
                    }}
                    style={[styles.tab, authTab === 'register' && styles.tabSelected]}
                  >
                    <Text style={[styles.tabText, authTab === 'register' && styles.tabTextSelected]}>
                      Create account
                    </Text>
                  </Pressable>
                </View>

                <TextInput
                  accessibilityLabel="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoComplete="email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  placeholder="Email"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
                <TextInput
                  ref={passwordInputRef}
                  accessibilityLabel="Password"
                  value={password}
                  onChangeText={setPassword}
                  autoComplete={authTab === 'signin' ? 'current-password' : 'new-password'}
                  textContentType={authTab === 'signin' ? 'password' : 'newPassword'}
                  secureTextEntry
                  placeholder={authTab === 'signin' ? 'Password' : 'Password (min. 8 characters)'}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  returnKeyType={authTab === 'signin' ? 'go' : 'next'}
                  onSubmitEditing={() => {
                    if (authTab === 'signin') {
                      void submitAuth();
                    } else {
                      confirmPasswordInputRef.current?.focus();
                    }
                  }}
                />
                {authTab === 'register' ? (
                  <TextInput
                    ref={confirmPasswordInputRef}
                    accessibilityLabel="Confirm Password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    placeholder="Confirm password"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    returnKeyType="go"
                    onSubmitEditing={() => void submitAuth()}
                  />
                ) : null}

                <ActionButton
                  title={isSubmitting ? 'Please wait…' : authTab === 'signin' ? 'Sign in' : 'Create account'}
                  onPress={() => void submitAuth()}
                  disabled={isSubmitting}
                />
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                {sessionError ? (
                  <ErrorState message={sessionError} onRetry={() => void refreshSession()} />
                ) : null}
                <Text style={styles.note}>
                  The WatchTube API establishes an HTTP-only secure cookie. Your password is never logged or exposed.
                </Text>
              </View>
            )}

            {sessionError && user ? (
              <ErrorState message={sessionError} onRetry={() => void refreshSession()} />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 20, paddingBottom: 36 },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  heading: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 12 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 20 },
  container: { gap: 16 },
  card: { gap: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 18 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { color: colors.success, fontSize: 16, fontWeight: '700' },
  roleBadge: { backgroundColor: colors.accentMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  roleText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  email: { color: colors.text, fontSize: 15 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  mutedText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.muted, fontSize: 12, marginTop: -4 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised },
  avatarLetter: { color: '#fff', fontSize: 18, fontWeight: '800' },
  channelMeta: { flex: 1 },
  channelName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  channelHandle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  channelActions: { gap: 8, marginTop: 4 },
  formGap: { gap: 10, marginTop: 6 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceRaised },
  tabSelected: { backgroundColor: colors.accentMuted, borderWidth: 1, borderColor: colors.accent },
  tabText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  tabTextSelected: { color: colors.text, fontWeight: '700' },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
  },
  multiline: { minHeight: 80, paddingVertical: 10, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
