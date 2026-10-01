import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadProfile } from '../../src/db/profile';
import { useSession } from '../../src/session';
import { fonts, usePalette } from '../../src/theme';

export default function HomeScreen() {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const { db } = useSession();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadProfile(db).then((profile) => {
      if (active) setName(profile?.name ?? null);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [db]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <Link href="/settings" style={[styles.settings, { color: colors.accent, fontFamily: fonts.label }]}>
          Settings
        </Link>
      </View>
      <View style={styles.empty}>
        {name ? <Text style={[styles.hello, { color: colors.text, fontFamily: fonts.heading }]}>{name}</Text> : null}
        <Text style={[styles.emptyCopy, { color: colors.textMuted, fontFamily: fonts.body }]}>No groups yet</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add group"
        onPress={() => Alert.alert('AllSquare', 'Groups arrive in the next step.')}
        style={[
          styles.fab,
          { backgroundColor: colors.accent, bottom: 24 + insets.bottom },
        ]}
      >
        <Text style={[styles.fabLabel, { color: colors.primary, fontFamily: fonts.heading }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 8 },
  settings: { fontSize: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  hello: { fontSize: 28, marginBottom: 8 },
  emptyCopy: { fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLabel: { fontSize: 32, lineHeight: 36 },
});
