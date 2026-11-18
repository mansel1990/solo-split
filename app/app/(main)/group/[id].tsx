import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiBaseUrl } from '../../../src/config';
import {
  addParty,
  archiveGroup,
  createShareLink,
  getGroup,
  getSelf,
  groupNets,
  listExpenses,
  listMembers,
  listParties,
  listSettlements,
  memberNames,
  removeParty,
  restoreParty,
  setLastGroupId,
  setPartyWeight,
  softDeleteSettlement,
  restoreSettlement,
  type ExpenseRow,
  type Party,
  type SettlementRow,
} from '../../../src/db/data';
import { roundWeight } from '../../../src/ids';
import {
  formatINR,
  formatSignedINR,
  memberLabel,
  simplifyDebts,
  type Transfer,
} from '../../../src/money';
import { notifyDataChanged, queueUndo, subscribeData } from '../../../src/refresh';
import { copyText, openWhatsApp, shareText, shareView } from '../../../src/shareActions';
import { scheduleSync, syncNow } from '../../../src/sync';
import { useSession } from '../../../src/session';
import { fonts, usePalette } from '../../../src/theme';
import { UndoHost } from '../../../src/ui';

type Tab = 'expenses' | 'balances' | 'parties';

export default function GroupScreen() {
  const colors = usePalette();
  const router = useRouter();
  const { db } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardRef = useRef<View>(null);
  const [tab, setTab] = useState<Tab>('expenses');
  const [name, setName] = useState('Group');
  const [parties, setParties] = useState<Party[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [nets, setNets] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Map<string, { name: string; is_self: number }>>(new Map());
  const [selfId, setSelfId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string; weight: number }[]>([]);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const [group, partyRows, expenseRows, settlementRows, netRows, nameRows, self, members] = await Promise.all([
      getGroup(db, id),
      listParties(db, id),
      listExpenses(db, id),
      listSettlements(db, id),
      groupNets(db, id),
      memberNames(db),
      getSelf(db),
      listMembers(db),
    ]);
    if (!group || group.deleted_at) return;
    setName(group.name);
    setParties(partyRows);
    setExpenses(expenseRows);
    setSettlements(settlementRows);
    setNets(netRows);
    setNames(nameRows);
    setSelfId(self?.id ?? null);
    const inGroup = new Set(partyRows.map((party) => party.member_id));
    setCandidates(members.filter((member) => !member.family_id && !inGroup.has(member.id)).map((member) => ({
      id: member.id,
      name: member.name,
      weight: member.weight,
    })));
    await setLastGroupId(db, id);
  }, [db, id]);

  useFocusEffect(useCallback(() => {
    void reload();
    return subscribeData(() => { void reload(); });
  }, [reload]));

  function label(memberId: string): string {
    const row = names.get(memberId);
    if (!row) return 'Someone';
    return memberLabel(row.name, memberId === selfId);
  }

  const { transfers, transferError } = useMemo(() => {
    const filled = { ...nets };
    for (const party of parties) {
      if (filled[party.member_id] == null) filled[party.member_id] = 0;
    }
    try {
      const next = simplifyDebts(filled);
      return { transfers: next, transferError: null as string | null };
    } catch (caught) {
      return {
        transfers: [] as Transfer[],
        transferError: caught instanceof Error ? caught.message : 'Balances could not be simplified',
      };
    }
  }, [nets, parties]);

  const cardLines = transfers.length === 0
    ? ['Settled']
    : transfers.map((transfer) => (
      `${label(transfer.fromMemberId)} pays ${label(transfer.toMemberId)} ${formatINR(transfer.amountPaise)}`
    ));

  function messageFor(memberId: string | null, url: string): string {
    const relevant = memberId
      ? transfers.filter((transfer) => transfer.fromMemberId === memberId || transfer.toMemberId === memberId)
      : transfers;
    const lines = relevant.length === 0
      ? ['Settled']
      : relevant.map((transfer) => `${label(transfer.fromMemberId)} pays ${label(transfer.toMemberId)} ${formatINR(transfer.amountPaise)}`);
    return [name, ...lines, url].join('\n');
  }

  async function urlFor(memberId: string | null): Promise<{ url: string; synced: boolean }> {
    if (!id) throw new Error('Missing group');
    const link = await createShareLink(db, id, memberId);
    const synced = await syncNow();
    scheduleSync();
    return { url: `${apiBaseUrl()}/s/${link.token}`, synced: synced.ok };
  }

  async function onCopy() {
    try {
      const { url, synced } = await urlFor(null);
      await copyText(url);
      setNotice(synced ? 'Link copied' : 'Link copied. It goes live once you are online.');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not copy the link');
    }
  }

  async function onWhatsApp(phone: string | null, memberId: string | null) {
    try {
      const { url, synced } = await urlFor(memberId);
      await openWhatsApp(phone, messageFor(memberId, url));
      if (!synced) setNotice('The link goes live once you are online.');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not open WhatsApp');
    }
  }

  async function onShareText() {
    try {
      const { url } = await urlFor(null);
      await shareText(messageFor(null, url));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not share');
    }
  }

  async function onShareCard() {
    try {
      await shareView(cardRef);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not share the card');
    }
  }

  function onArchive() {
    if (!id) return;
    Alert.alert('Archive this group?', 'It leaves the home screen. The expenses stay on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await archiveGroup(db, id);
            notifyDataChanged();
            scheduleSync();
            router.back();
          })();
        },
      },
    ]);
  }

  const selfNet = selfId ? (nets[selfId] ?? 0) : 0;
  const netColor = selfNet > 0 ? colors.positive : selfNet < 0 ? colors.negative : colors.text;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.net, { color: netColor, fontFamily: fonts.heading }]}>{formatSignedINR(selfNet)}</Text>
        <View style={styles.tabs}>
          <TabButton label="Expenses" selected={tab === 'expenses'} onPress={() => setTab('expenses')} />
          <TabButton label="Balances" selected={tab === 'balances'} onPress={() => setTab('balances')} />
          <TabButton label="Parties" selected={tab === 'parties'} onPress={() => setTab('parties')} />
        </View>

        {tab === 'expenses' ? (
          <View style={styles.block}>
            <Pressable
              onPress={() => router.push({ pathname: '/expense/edit', params: { groupId: id } })}
              style={[styles.add, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.addLabel, { color: colors.primary, fontFamily: fonts.label }]}>Add expense</Text>
            </Pressable>
            {expenses.length === 0 ? (
              <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]}>No expenses yet</Text>
            ) : expenses.map((expense) => (
              <Pressable
                key={expense.id}
                onPress={() => router.push({ pathname: '/expense/edit', params: { groupId: id, expenseId: expense.id } })}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.label }]}>
                    {expense.note || expense.category || 'Expense'}
                  </Text>
                  <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]}>
                    {expense.spent_on} · {label(expense.paid_by)} paid
                  </Text>
                </View>
                <Text style={[styles.cardAmount, { color: colors.text, fontFamily: fonts.label }]}>{formatINR(expense.amount_paise)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tab === 'balances' ? (
          <View style={styles.block}>
            {parties.map((party) => {
              const net = nets[party.member_id] ?? 0;
              const color = net > 0 ? colors.positive : net < 0 ? colors.negative : colors.textMuted;
              return (
                <View key={party.member_id} style={styles.balanceRow}>
                  <Text style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.body }]}>{label(party.member_id)}</Text>
                  <Text style={{ color, fontFamily: fonts.label }}>{formatSignedINR(net)}</Text>
                </View>
              );
            })}
            {transferError ? <Text style={[styles.muted, { color: colors.negative, fontFamily: fonts.body }]}>{transferError}</Text> : null}
            <Pressable
              onPress={() => router.push({ pathname: '/settle', params: { groupId: id } })}
              style={[styles.add, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.addLabel, { color: colors.primary, fontFamily: fonts.label }]}>Record a payment</Text>
            </Pressable>
            {transfers.map((transfer) => (
              <View key={`${transfer.fromMemberId}-${transfer.toMemberId}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.body, flex: 1 }]}>
                  {label(transfer.fromMemberId)} pays {label(transfer.toMemberId)} {formatINR(transfer.amountPaise)}
                </Text>
                <Pressable
                  onPress={() => router.push({
                    pathname: '/settle',
                    params: {
                      groupId: id,
                      fromId: transfer.fromMemberId,
                      toId: transfer.toMemberId,
                      amount: String(transfer.amountPaise),
                    },
                  })}
                >
                  <Text style={{ color: colors.accent, fontFamily: fonts.label }}>Record</Text>
                </Pressable>
              </View>
            ))}
            {settlements.length > 0 ? (
              <Text style={[styles.section, { color: colors.text, fontFamily: fonts.heading }]}>Payments</Text>
            ) : null}
            {settlements.map((row) => (
              <View key={row.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.body }]}>
                    {label(row.from_member)} paid {label(row.to_member)} {formatINR(row.amount_paise)}
                  </Text>
                  <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]}>{row.paid_on}</Text>
                </View>
                <Pressable onPress={() => {
                  void (async () => {
                    await softDeleteSettlement(db, row.id);
                    scheduleSync();
                    queueUndo('Payment removed', () => restoreSettlement(db, row.id));
                    await reload();
                  })();
                }}
                >
                  <Text style={{ color: colors.negative, fontFamily: fonts.label }}>Undo</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {tab === 'parties' ? (
          <View style={styles.block}>
            {parties.map((party) => (
              <View key={party.member_id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.label }]}>{label(party.member_id)}</Text>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => {
                        const next = roundWeight(Math.max(0.5, (party.weight ?? party.member_weight) - 0.5));
                        void setPartyWeight(db, party.group_id, party.member_id, next).then(() => {
                          scheduleSync();
                          return reload();
                        });
                      }}
                      style={[styles.step, { borderColor: colors.border }]}
                    >
                      <Text style={{ color: colors.text }}>−</Text>
                    </Pressable>
                    <Text style={{ color: colors.text, fontFamily: fonts.body }}>{party.weight ?? party.member_weight}</Text>
                    <Pressable
                      onPress={() => {
                        const next = roundWeight((party.weight ?? party.member_weight) + 0.5);
                        void setPartyWeight(db, party.group_id, party.member_id, next).then(() => {
                          scheduleSync();
                          return reload();
                        });
                      }}
                      style={[styles.step, { borderColor: colors.border }]}
                    >
                      <Text style={{ color: colors.text }}>+</Text>
                    </Pressable>
                  </View>
                </View>
                {party.is_self ? null : (
                  <Pressable onPress={() => {
                    void removeParty(db, party.group_id, party.member_id).then(() => {
                      scheduleSync();
                      queueUndo(`${party.name} removed`, () => restoreParty(db, party.group_id, party.member_id));
                      return reload();
                    });
                  }}
                  >
                    <Text style={{ color: colors.negative, fontFamily: fonts.label }}>Remove</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {candidates.length > 0 ? (
              <Text style={[styles.section, { color: colors.text, fontFamily: fonts.heading }]}>Add</Text>
            ) : (
              <Pressable onPress={() => router.push('/people')}>
                <Text style={{ color: colors.accent, fontFamily: fonts.label }}>Add someone in People first</Text>
              </Pressable>
            )}
            {candidates.map((member) => (
              <Pressable
                key={member.id}
                onPress={() => {
                  void addParty(db, id!, member.id, member.weight).then(() => {
                    scheduleSync();
                    return reload();
                  });
                }}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.label }]}>{member.name}</Text>
                <Text style={{ color: colors.accent, fontFamily: fonts.label }}>Add</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable onPress={() => setSharing((current) => !current)} style={styles.shareToggle}>
          <Text style={{ color: colors.accent, fontFamily: fonts.label }}>{sharing ? 'Hide share' : 'Share'}</Text>
        </Pressable>
        {sharing ? (
          <View style={styles.block}>
            <View
              ref={cardRef}
              collapsable={false}
              style={[styles.cardView, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.cardName, { color: '#F3F6FA', fontFamily: fonts.heading }]}>{name}</Text>
              {cardLines.map((line, index) => (
                <Text key={`${index}-${line}`} style={[styles.cardLine, { color: '#F3F6FA', fontFamily: fonts.body }]}>{line}</Text>
              ))}
              <Text style={[styles.brand, { color: colors.accent, fontFamily: fonts.label }]}>allsquare</Text>
            </View>
            <Pressable onPress={() => { void onCopy(); }}><Text style={[styles.shareAction, { color: colors.text, fontFamily: fonts.label }]}>Copy link</Text></Pressable>
            <Pressable onPress={() => { void onShareText(); }}><Text style={[styles.shareAction, { color: colors.text, fontFamily: fonts.label }]}>Share text</Text></Pressable>
            <Pressable onPress={() => { void onShareCard(); }}><Text style={[styles.shareAction, { color: colors.text, fontFamily: fonts.label }]}>Share card</Text></Pressable>
            <Pressable onPress={() => { void onWhatsApp(null, null); }}><Text style={[styles.shareAction, { color: colors.text, fontFamily: fonts.label }]}>WhatsApp</Text></Pressable>
            {parties.filter((party) => party.phone && !party.is_self).map((party) => (
              <Pressable key={party.member_id} onPress={() => { void onWhatsApp(party.phone, party.member_id); }}>
                <Text style={[styles.shareAction, { color: colors.text, fontFamily: fonts.label }]}>WhatsApp {party.name}</Text>
              </Pressable>
            ))}
            {notice ? <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]}>{notice}</Text> : null}
          </View>
        ) : null}
        <Pressable onPress={onArchive} style={styles.archive}>
          <Text style={{ color: colors.negative, fontFamily: fonts.label }}>Archive group</Text>
        </Pressable>
      </ScrollView>
      <UndoHost />
    </View>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = usePalette();
  return (
    <Pressable onPress={onPress} style={[styles.tab, { borderBottomColor: selected ? colors.accent : 'transparent' }]}>
      <Text style={{ color: selected ? colors.text : colors.textMuted, fontFamily: fonts.label }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  net: { fontSize: 32 },
  tabs: { flexDirection: 'row', gap: 16, marginTop: 16 },
  tab: { borderBottomWidth: 2, paddingBottom: 6 },
  block: { marginTop: 16, gap: 10 },
  add: { borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  addLabel: { fontSize: 16 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: { fontSize: 15 },
  cardAmount: { fontSize: 15 },
  muted: { fontSize: 13, marginTop: 2 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  section: { fontSize: 18, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  step: { borderWidth: 1, borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  shareToggle: { marginTop: 24 },
  cardView: { borderRadius: 18, padding: 18, gap: 6 },
  cardName: { fontSize: 22 },
  cardLine: { fontSize: 15 },
  brand: { marginTop: 8, fontSize: 13 },
  shareAction: { fontSize: 16, paddingVertical: 6 },
  archive: { marginTop: 28 },
});
