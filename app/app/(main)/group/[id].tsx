import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

type Tab = 'expenses' | 'balances' | 'parties' | 'spend';

const CATEGORY_ORDER = ['Stay', 'Travel', 'Food', 'Drinks', 'Other'];

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

  const spend = useMemo(() => tripSpend(expenses, parties), [expenses, parties]);

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

  function recordTransfer(transfer: Transfer) {
    router.push({
      pathname: '/settle',
      params: {
        groupId: id,
        fromId: transfer.fromMemberId,
        toId: transfer.toMemberId,
        amount: String(transfer.amountPaise),
      },
    });
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
  const payers = payerBars(expenses, label);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share"
              onPress={() => setSharing(true)}
              hitSlop={8}
              style={styles.shareIcon}
            >
              <Ionicons name="share-outline" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <View
        ref={cardRef}
        collapsable={false}
        pointerEvents="none"
        style={[styles.cardView, styles.cardOffscreen, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.cardName, { color: '#F3F6FA', fontFamily: fonts.heading }]}>{name}</Text>
        {cardLines.map((line, index) => (
          <Text key={`${index}-${line}`} style={[styles.cardLine, { color: '#F3F6FA', fontFamily: fonts.body }]}>{line}</Text>
        ))}
        <Text style={[styles.brand, { color: colors.accent, fontFamily: fonts.label }]}>allsquare</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.net, { color: netColor, fontFamily: fonts.heading }]}>{formatSignedINR(selfNet)}</Text>
        <View style={styles.tabs}>
          <TabButton label="Expenses" selected={tab === 'expenses'} onPress={() => setTab('expenses')} />
          <TabButton label="Balances" selected={tab === 'balances'} onPress={() => setTab('balances')} />
          <TabButton label="Parties" selected={tab === 'parties'} onPress={() => setTab('parties')} />
          <TabButton label="Spend" selected={tab === 'spend'} onPress={() => setTab('spend')} />
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
            {transfers.map((transfer) => {
              const from = label(transfer.fromMemberId);
              const to = label(transfer.toMemberId);
              return (
                <View key={`${transfer.fromMemberId}-${transfer.toMemberId}`} style={[styles.transfer, { backgroundColor: colors.surface }]}>
                  <View style={[styles.transferBar, { backgroundColor: colors.accent }]} />
                  <View style={styles.transferBody}>
                    <View style={styles.initials}>
                      <Initial letter={initials(from)} />
                      <Initial letter={initials(to)} overlap />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.transferAmount, { color: colors.text, fontFamily: fonts.heading }]}>
                        {formatINR(transfer.amountPaise)}
                      </Text>
                      <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]} numberOfLines={1}>
                        {from} pays {to}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => recordTransfer(transfer)}
                      style={[styles.record, { backgroundColor: colors.accent }]}
                    >
                      <Text style={{ color: colors.primary, fontFamily: fonts.label, fontSize: 13 }}>Record</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {settlements.length > 0 ? (
              <Text style={[styles.section, { color: colors.text, fontFamily: fonts.heading }]}>Paid</Text>
            ) : null}
            {settlements.map((row, index) => (
              <View key={row.id} style={styles.paidRow}>
                <View style={styles.rail}>
                  <View style={[styles.dot, { backgroundColor: colors.positive }]} />
                  {index < settlements.length - 1 ? (
                    <View style={[styles.hairline, { backgroundColor: colors.border }]} />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.paidDate, { color: colors.textMuted, fontFamily: fonts.body }]}>{row.paid_on}</Text>
                  <Text style={[styles.paidLine, { color: colors.text, fontFamily: fonts.body }]}>
                    {label(row.from_member)} → {label(row.to_member)}
                  </Text>
                  <Text style={[styles.paidAmount, { color: colors.text, fontFamily: fonts.body }]}>{formatINR(row.amount_paise)}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void (async () => {
                      await softDeleteSettlement(db, row.id);
                      scheduleSync();
                      queueUndo('Payment removed', () => restoreSettlement(db, row.id));
                      await reload();
                    })();
                  }}
                >
                  <Text style={[styles.undo, { color: colors.textMuted, fontFamily: fonts.label }]}>Undo</Text>
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

        {tab === 'spend' ? (
          <View style={styles.block}>
            {expenses.length === 0 ? (
              <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]}>No expenses yet</Text>
            ) : (
              <>
                <Text style={[styles.total, { color: colors.text, fontFamily: fonts.heading }]}>{formatINR(spend.total)}</Text>
                {spend.perPerson != null ? (
                  <Text style={[styles.rate, { color: colors.text, fontFamily: fonts.label }]}>
                    {spend.days > 1
                      ? `${formatINR(spend.perPersonPerDay ?? spend.perPerson)} a person a day`
                      : `${formatINR(spend.perPerson)} a person`}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  {[
                    spend.heads > 0 ? countPhrase(spend.heads, 'person', 'people') : null,
                    spend.days > 0 ? countPhrase(spend.days, 'day', 'days') : null,
                    countPhrase(expenses.length, 'expense', 'expenses'),
                  ].filter(Boolean).join(' · ')}
                </Text>
                <Text style={[styles.section, { color: colors.text, fontFamily: fonts.heading }]}>By category</Text>
                {spend.categories.map((row) => (
                  <Bar key={row.label} label={row.label} amount={row.amount} total={spend.total} color={colors.accent} />
                ))}
                <Text style={[styles.section, { color: colors.text, fontFamily: fonts.heading }]}>Who paid</Text>
                {payers.map((row) => (
                  <Bar key={row.id} label={row.label} amount={row.amount} total={spend.total} color={colors.secondary} />
                ))}
              </>
            )}
          </View>
        ) : null}

        <Pressable onPress={onArchive} style={styles.archive}>
          <Text style={{ color: colors.negative, fontFamily: fonts.label }}>Archive group</Text>
        </Pressable>
      </ScrollView>
      <Modal visible={sharing} transparent animationType="slide" onRequestClose={() => setSharing(false)}>
        <View style={styles.modal}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close share" style={styles.backdrop} onPress={() => setSharing(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.grab, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.text, fontFamily: fonts.heading }]}>Share</Text>
            <ShareAction label="Copy link" onPress={() => { void onCopy(); }} />
            <ShareAction label="Share text" onPress={() => { void onShareText(); }} />
            <ShareAction label="Share card" onPress={() => { void onShareCard(); }} />
            <ShareAction label="WhatsApp" onPress={() => { void onWhatsApp(null, null); }} />
            {parties.filter((party) => party.phone && !party.is_self).map((party) => (
              <ShareAction
                key={party.member_id}
                label={`WhatsApp ${party.name}`}
                onPress={() => { void onWhatsApp(party.phone, party.member_id); }}
              />
            ))}
            {notice ? <Text style={[styles.muted, { color: colors.textMuted, fontFamily: fonts.body }]}>{notice}</Text> : null}
          </View>
        </View>
      </Modal>
      <UndoHost />
    </View>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = usePalette();
  return (
    <Pressable onPress={onPress} style={[styles.tab, { borderBottomColor: selected ? colors.accent : 'transparent' }]}>
      <Text style={[styles.tabLabel, { color: selected ? colors.text : colors.textMuted, fontFamily: fonts.label }]}>{label}</Text>
    </Pressable>
  );
}

function Initial({ letter, overlap = false }: { letter: string; overlap?: boolean }) {
  const colors = usePalette();
  return (
    <View
      style={[
        styles.initial,
        overlap ? styles.initialOverlap : null,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.label, fontSize: 12 }}>{letter}</Text>
    </View>
  );
}

function Bar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const colors = usePalette();
  const share = total > 0 ? Math.min(1, Math.max(0, amount / total)) : 0;
  const filled = amount > 0 ? Math.max(share, 0.03) : 0;
  return (
    <View style={styles.barBlock}>
      <View style={styles.barHead}>
        <Text style={[styles.barLabel, { color: colors.text, fontFamily: fonts.body }]}>{label}</Text>
        <Text style={[styles.barLabel, { color: colors.text, fontFamily: fonts.label }]}>{formatINR(amount)}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={{ flex: filled, backgroundColor: color, borderRadius: 4 }} />
        <View style={{ flex: Math.max(1 - filled, 0) }} />
      </View>
    </View>
  );
}

function ShareAction({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.shareAction}>
      <Text style={{ color: colors.text, fontFamily: fonts.label, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

type SpendBar = { label: string; amount: number };

function tripSpend(expenses: ExpenseRow[], parties: Party[]) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount_paise, 0);
  const heads = roundWeight(parties.reduce((sum, party) => sum + (party.weight ?? party.member_weight), 0));
  const dates = expenses.map((expense) => expense.spent_on).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  const days = dates.length === 0 ? 0 : inclusiveDays(dates[0], dates[dates.length - 1]);
  const perPerson = heads > 0 ? Math.round(total / heads) : null;
  const perPersonPerDay = heads > 0 && days > 1 ? Math.round(total / heads / days) : null;
  return { total, heads, days, perPerson, perPersonPerDay, categories: categoryBars(expenses) };
}

function inclusiveDays(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00`);
  const to = Date.parse(`${end}T00:00:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 1;
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
}

function categoryBars(expenses: ExpenseRow[]): SpendBar[] {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const key = expense.category?.trim() || 'Uncategorised';
    totals.set(key, (totals.get(key) ?? 0) + expense.amount_paise);
  }
  const rows: SpendBar[] = [];
  for (const label of CATEGORY_ORDER) {
    const amount = totals.get(label) ?? 0;
    if (amount > 0) rows.push({ label, amount });
    totals.delete(label);
  }
  const rest = [...totals.entries()].filter(([, amount]) => amount > 0);
  rest.sort((a, b) => {
    if (a[0] === 'Uncategorised') return 1;
    if (b[0] === 'Uncategorised') return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  for (const [label, amount] of rest) rows.push({ label, amount });
  return rows;
}

function payerBars(expenses: ExpenseRow[], label: (memberId: string) => string): (SpendBar & { id: string })[] {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    totals.set(expense.paid_by, (totals.get(expense.paid_by) ?? 0) + expense.amount_paise);
  }
  return [...totals.entries()]
    .map(([id, amount]) => ({ id, label: label(id), amount }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

function countPhrase(count: number, singular: string, plural: string): string {
  const shown = Number.isInteger(count) ? String(count) : String(roundWeight(count));
  return `${shown} ${count === 1 ? singular : plural}`;
}

function initials(name: string): string {
  const cleaned = name.replace(/\s*\(you\)\s*$/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  net: { fontSize: 32 },
  shareIcon: { paddingHorizontal: 4, paddingVertical: 4 },
  tabs: { flexDirection: 'row', gap: 12, marginTop: 16 },
  tab: { borderBottomWidth: 2, paddingBottom: 6 },
  tabLabel: { fontSize: 14 },
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
  transfer: { flexDirection: 'row', borderRadius: 16, overflow: 'hidden' },
  transferBar: { width: 3 },
  transferBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingRight: 12, paddingLeft: 12 },
  initials: { flexDirection: 'row', alignItems: 'center' },
  initial: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialOverlap: { marginLeft: -8 },
  transferAmount: { fontSize: 18 },
  record: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  paidRow: { flexDirection: 'row', gap: 12, minHeight: 64 },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  hairline: { width: 1, flex: 1, marginTop: 4 },
  paidDate: { fontSize: 12 },
  paidLine: { fontSize: 15, marginTop: 2 },
  paidAmount: { fontSize: 15, marginTop: 2 },
  undo: { fontSize: 13, paddingVertical: 4 },
  total: { fontSize: 36 },
  rate: { fontSize: 16, marginTop: 4 },
  meta: { fontSize: 13, marginTop: 4 },
  barBlock: { gap: 6 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  barLabel: { fontSize: 14 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  step: { borderWidth: 1, borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  cardView: { borderRadius: 18, padding: 18, gap: 6 },
  cardOffscreen: { position: 'absolute', left: -1200, top: 0, width: 320 },
  cardName: { fontSize: 22 },
  cardLine: { fontSize: 15 },
  brand: { marginTop: 8, fontSize: 13 },
  archive: { marginTop: 28 },
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7, 21, 42, 0.45)',
  },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: 2 },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetTitle: { fontSize: 20, marginBottom: 8 },
  shareAction: { paddingVertical: 12 },
});
