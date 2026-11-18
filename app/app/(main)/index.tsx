import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLastGroupId, getSelf, groupNets, listGroups } from '../../src/db/data';
import { formatSignedINR } from '../../src/money';
import { subscribeData } from '../../src/refresh';
import { subscribeSync, syncNow, useSyncSnapshot, type SyncStatus } from '../../src/sync';
import { useSession } from '../../src/session';
import { fonts, usePalette } from '../../src/theme';
import { UndoHost } from '../../src/ui';

type Row = { id: string; name: string; net: number };

export default function HomeScreen() {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { db } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [net, setNet] = useState(0);
  const [status, setStatus] = useState<SyncStatus>(useSyncSnapshot());

  const reload = useCallback(async () => {
    const groups = await listGroups(db);
    const self = await getSelf(db);
    const next: Row[] = [];
    for (const group of groups) {
      const nets = await groupNets(db, group.id);
      next.push({ id: group.id, name: group.name, net: self ? (nets[self.id] ?? 0) : 0 });
    }
    setRows(next);
    setNet(next.reduce((sum, row) => sum + row.net, 0));
  }, [db]);

  useFocusEffect(useCallback(() => {
    void reload();
    return subscribeData(() => { void reload(); });
  }, [reload]));

  useEffect(() => {
    return subscribeSync((next) => {
      setStatus(next);
      if (next.state === 'saved') void reload();
    });
  }, [reload]);

  async function quickAdd() {
    const groups = await listGroups(db);
    const last = await getLastGroupId(db);
    const target = groups.find((group) => group.id === last) ?? groups[0];
    if (!target) router.push('/group/create');
    else router.push({ pathname: '/expense/edit', params: { groupId: target.id } });
  }

  const netColor = net > 0 ? colors.positive : net < 0 ? colors.negative : colors.text;
  const summary = net > 0 ? 'You are owed' : net < 0 ? 'You owe' : 'All square';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <Pressable onPress={() => router.push('/people')}>
            <Text style={[styles.link, { color: colors.accent, fontFamily: fonts.label }]}>People</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/settings')}>
            <Text style={[styles.link, { color: colors.accent, fontFamily: fonts.label }]}>Settings</Text>
          </Pressable>
        </View>
        <Text style={[styles.summary, { color: colors.textMuted, fontFamily: fonts.body }]}>{summary}</Text>
        <Text style={[styles.net, { color: netColor, fontFamily: fonts.heading }]}>{formatSignedINR(net)}</Text>
        <Pressable onPress={() => { void syncNow(); }}>
          <Text style={[styles.sync, { color: status.state === 'error' ? colors.negative : colors.textMuted, fontFamily: fonts.body }]}>
            {status.state === 'idle' ? 'Tap to sync' : status.message}
          </Text>
        </Pressable>
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyCopy, { color: colors.textMuted, fontFamily: fonts.body }]}>No groups yet</Text>
            <Pressable onPress={() => router.push('/group/create')} style={[styles.newGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.newGroupLabel, { color: colors.text, fontFamily: fonts.label }]}>New group</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => {
              const color = row.net > 0 ? colors.positive : row.net < 0 ? colors.negative : colors.text;
              return (
                <Pressable
                  key={row.id}
                  onPress={() => router.push({ pathname: '/group/[id]', params: { id: row.id } })}
                  style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[styles.cardName, { color: colors.text, fontFamily: fonts.label }]}>{row.name}</Text>
                  <Text style={[styles.cardNet, { color, fontFamily: fonts.label }]}>{formatSignedINR(row.net)}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => router.push('/group/create')}>
              <Text style={[styles.link, { color: colors.accent, fontFamily: fonts.label }]}>New group</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      <UndoHost />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        onPress={() => { void quickAdd(); }}
        style={[styles.fab, { backgroundColor: colors.accent, bottom: 24 + insets.bottom }]}
      >
        <Text style={[styles.fabLabel, { color: colors.primary, fontFamily: fonts.heading }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingBottom: 120 },
  top: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
  link: { fontSize: 16 },
  summary: { marginTop: 28, fontSize: 15 },
  net: { fontSize: 40, marginTop: 4 },
  sync: { marginTop: 8, fontSize: 13 },
  empty: { marginTop: 48, alignItems: 'flex-start' },
  emptyCopy: { fontSize: 16 },
  newGroup: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  newGroupLabel: { fontSize: 16 },
  list: { marginTop: 28, gap: 12 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  cardName: { fontSize: 17, flex: 1 },
  cardNet: { fontSize: 16 },
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
