import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: 54 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="shorts" options={{ title: 'Shorts', tabBarLabel: 'Shorts' }} />
      <Tabs.Screen name="trending" options={{ title: 'Trending', tabBarLabel: 'Trending' }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarLabel: 'Search' }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarLabel: 'Account' }} />
    </Tabs>
  );
}
