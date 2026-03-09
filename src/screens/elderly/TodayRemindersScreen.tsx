import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});

async function registerForPushNotifications(userId: number) {
  if (!Device.isDevice) return;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;
  const tokenData = await Notifications.getExpoPushTokenAsync();
  try {
    await fetch(getApiUrl('/api/push-token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token: tokenData.data }),
    });
  } catch (e) { console.log('Push token save failed', e); }
}

// =============================================================================
// Types
// =============================================================================
type ScheduleType = 'medicine' | 'appointment' | 'routine' | 'reminder';

/**
 * DB / API statuses:
 *   taken      → taken full dose
 *   partial    → taken partial dose (partial_dose has details)
 *   missed     → explicitly skipped OR system-marked overdue
 *   snoozed    → snoozed, snooze_until has the wake time
 *
 * is_overdue=1 always wins over status='missed'
 */
// log_status values returned by /api/schedules/today
// maps DB intake status → frontend display token
type LogStatus = 'done' | 'partial' | 'skipped' | 'not_taken' | 'overdue' | 'snoozed' | null;

/**
 * Visual state drives card appearance & available actions.
 *
 * State machine (from server perspective):
 *   upcoming  → scheduled time hasn't arrived yet
 *   pending   → scheduled time passed, 0 reminders sent
 *   reminded  → 1+ reminders sent, not yet responded
 *   snoozed   → elder snoozed — show snooze countdown
 *   not_taken → elder explicitly tapped "Not Taken / Skip"
 *   partial   → terminal positive: partial dose logged
 *   taken     → terminal positive: full dose taken
 *   overdue   → max reminders exhausted, no response → system auto-marks
 */
type VisualState = 'upcoming' | 'pending' | 'reminded' | 'snoozed' | 'not_taken' | 'partial' | 'taken' | 'overdue';

interface ScheduleItem {
  id:              number;
  type:            ScheduleType;
  title:           string;
  description?:    string;
  dosage?:         string;
  scheduled_time:  string;
  caregiver_name:  string;
  repeat_interval: number;
  max_reminders:   number;
  log_id?:          number;
  log_status?:      LogStatus;
  is_overdue?:      number;
  reminded_count?:  number;
  snooze_until?:    string | null;
  snooze_count?:    number;           // total times snoozed today
  partial_dose?:    string | null;
  actual_taken_at?: string | null;    // when the dose was actually taken (taken/partial only)
  response_note?:   string | null;
}

type ActionMode = 'taken' | 'partial' | 'snooze' | null;

const SNOOZE_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
];

const TYPE_CONFIG: Record<ScheduleType, { icon: string; color: string; label: string }> = {
  medicine:    { icon: '💊', color: '#7c6fcd', label: 'Medicine'    },
  appointment: { icon: '🏥', color: '#4a9eed', label: 'Appointment' },
  routine:     { icon: '🌿', color: '#27ae60', label: 'Routine'     },
  reminder:    { icon: '🔔', color: '#e67e22', label: 'Reminder'    },
};

// =============================================================================
// Helpers
// =============================================================================
const fmtTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/**
 * Pure function: derives visual state from item data + current time.
 * This is the single source of truth — no duplicated logic anywhere.
 */
function computeVisualState(item: ScheduleItem): VisualState {
  // Terminal states first — is_overdue always wins
  if (item.is_overdue) return 'overdue';
  if (item.log_status === 'done')     return 'taken';
  if (item.log_status === 'partial')  return 'partial';
  // Server returns 'not_taken' for DB status 'not_taken'
  // and 'skipped' for DB status 'missed' (non-overdue)
  if (item.log_status === 'not_taken' || item.log_status === 'skipped') return 'not_taken';

  // Snooze: only active if snooze_until is in the future
  if (item.log_status === 'snoozed' && item.snooze_until) {
    if (new Date(item.snooze_until) > new Date()) return 'snoozed';
    // snooze expired — server will reset to 'pending' on next cron tick,
    // but until then fall through to pending/reminded below
  }

  const now = new Date();
  const [hh, mm] = item.scheduled_time.split(':').map(Number);
  const scheduled = new Date();
  scheduled.setHours(hh, mm, 0, 0);

  if (now < scheduled) return 'upcoming';

  return (item.reminded_count ?? 0) > 0 ? 'reminded' : 'pending';
}

// =============================================================================
// Snooze countdown hook
// =============================================================================
function useSnoozeMins(snoozeUntil: string | null | undefined): number {
  const [mins, setMins] = useState(0);
  useEffect(() => {
    if (!snoozeUntil) { setMins(0); return; }
    const tick = () => {
      const diff = Math.max(0, Math.ceil((new Date(snoozeUntil).getTime() - Date.now()) / 60000));
      setMins(diff);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [snoozeUntil]);
  return mins;
}

// =============================================================================
// Individual card component (extracted for cleanliness)
// =============================================================================
const ScheduleCard = ({
  item,
  onTaken,
  onPartial,
  onSnooze,
  onNotTaken,
}: {
  item: ScheduleItem;
  onTaken:   (item: ScheduleItem) => void;
  onPartial: (item: ScheduleItem) => void;
  onSnooze:  (item: ScheduleItem) => void;
  onNotTaken:(item: ScheduleItem) => void;
}) => {
  const c   = TYPE_CONFIG[item.type];
  const vs  = computeVisualState(item);
  const snoozeMins = useSnoozeMins(item.snooze_until);

  const interval = Math.max(1, item.repeat_interval || 30);
  const maxR     = Math.max(1, item.max_reminders   || 3);
  const reminded = item.reminded_count || 0;

  const [hh2, mm2] = item.scheduled_time.split(':').map(Number);
  const nextReminderMin = hh2 * 60 + mm2 + (reminded + 1) * interval;
  const nextH = Math.floor(nextReminderMin / 60) % 24;
  const nextM = nextReminderMin % 60;
  const nextReminderLabel = `${nextH % 12 || 12}:${String(nextM).padStart(2, '0')} ${nextH >= 12 ? 'PM' : 'AM'}`;

  const cardBorderColor =
    vs === 'overdue'   ? '#c0392b' :
    vs === 'taken'     ? '#27ae60' :
    vs === 'partial'   ? '#8e44ad' :
    vs === 'not_taken' ? '#e17055' :
    vs === 'snoozed'   ? '#2980b9' :
    vs === 'upcoming'  ? '#74b9ff' :
    vs === 'reminded'  ? '#e67e22' : c.color;

  return (
    <View style={[
      S.card,
      vs === 'taken'     && S.cardTaken,
      vs === 'partial'   && S.cardPartial,
      vs === 'not_taken' && S.cardNotTaken,
      vs === 'overdue'   && S.cardOverdue,
      vs === 'snoozed'   && S.cardSnoozed,
      vs === 'upcoming'  && S.cardUpcoming,
      { borderLeftColor: cardBorderColor },
    ]}>
      {/* Time badge */}
      <View style={[S.timeBadge, { backgroundColor: cardBorderColor }]}>
        <Text style={S.timeBadgeTxt}>{fmtTime(item.scheduled_time)}</Text>
      </View>

      <View style={S.cardBody}>
        {/* Top row: type pill + state badge */}
        <View style={S.cardTop}>
          <View style={[S.typePill, { backgroundColor: c.color + '20' }]}>
            <Text style={[S.typePillTxt, { color: c.color }]}>{c.icon} {c.label}</Text>
          </View>
          {vs === 'upcoming'  && <StateBadge color="#0984e3" bg="#dbeeff"  icon="🕐" label="Upcoming" />}
          {vs === 'pending'   && <StateBadge color="#e67e22" bg="#fff3e6"  icon="⏳" label="Pending" />}
          {vs === 'reminded'  && <StateBadge color="#e67e22" bg="#fff8e1"  icon="🔔" label={`Reminded ${reminded}/${maxR}`} />}
          {vs === 'taken'     && <StateBadge color="#27ae60" bg="#d4faf0"  icon="✅" label="Taken" />}
          {vs === 'partial'   && <StateBadge color="#8e44ad" bg="#f3e5ff"  icon="💊" label="Partial Dose" />}
          {vs === 'not_taken' && <StateBadge color="#e17055" bg="#fff0e8"  icon="❌" label="Not Taken" />}
          {vs === 'snoozed'   && <StateBadge color="#2980b9" bg="#e8f4fd"  icon="😴" label={snoozeMins > 0 ? `Snoozed ${snoozeMins}m` : 'Snooze expired'} />}
          {vs === 'overdue'   && <StateBadge color="#c0392b" bg="#ffe0e0"  icon="🚨" label="Overdue" />}
        </View>

        {/* Title & details */}
        <Text style={[S.cardTitle, (vs === 'taken' || vs === 'partial') && S.cardTitleFaded]}>
          {item.title}
        </Text>
        {item.dosage      && <Text style={S.cardDosage}>💊 {item.dosage}</Text>}
        {item.description && <Text style={S.cardDesc}>{item.description}</Text>}
        <Text style={S.cardCG}>Scheduled by: {item.caregiver_name}</Text>

        {/* State-specific info boxes */}
        {vs === 'upcoming' && (
          <InfoBox color="#0984e3" bg="#e8f4ff" border="#bee3ff">
            ⏰ Scheduled for {fmtTime(item.scheduled_time)} — you'll be reminded then.
          </InfoBox>
        )}

        {vs === 'reminded' && (
          <InfoBox color="#e67e22" bg="#fff8e1" border="#ffeaa7">
            🔔 Reminder {reminded} of {maxR} sent.
            {reminded < maxR
              ? ` Next reminder at ${nextReminderLabel}.`
              : ' This was the last reminder — please respond.'}
          </InfoBox>
        )}

        {vs === 'snoozed' && (
          <InfoBox color="#2980b9" bg="#e8f4fd" border="#bee8ff">
            😴 Snoozed — you'll be reminded again{item.snooze_until
              ? ` at ${fmtDateTime(item.snooze_until)}.`
              : '.'}
            {snoozeMins > 0 ? ` (${snoozeMins} min remaining)` : ' Snooze has expired.'}
            {(item.snooze_count ?? 0) > 1 ? ` Snoozed ${item.snooze_count} times today.` : ''}
          </InfoBox>
        )}

        {vs === 'partial' && (
          <View style={[S.resultBox, { backgroundColor: '#f8f0ff', borderColor: '#d6b8ff' }]}>
            <Text style={[S.resultBoxTxt, { color: '#8e44ad' }]}>
              💊 Partial dose taken{item.partial_dose ? ` — ${item.partial_dose}` : ''}.
              {item.response_note ? ` "${item.response_note}"` : ''}
            </Text>
          </View>
        )}

        {vs === 'not_taken' && (
          <View style={[S.resultBox, { backgroundColor: '#fff5f0', borderColor: '#ffccbb' }]}>
            <Text style={[S.resultBoxTxt, { color: '#e17055' }]}>
              You marked this as not taken.
              {reminded < maxR
                ? ` You'll be reminded again at ${nextReminderLabel}.`
                : ' All reminders have been sent.'}
            </Text>
            <TouchableOpacity style={[S.takenBtn, { marginTop: 10 }]} onPress={() => onTaken(item)}>
              <Text style={S.takenBtnTxt}>✅  Mark as Taken Now</Text>
            </TouchableOpacity>
          </View>
        )}

        {vs === 'overdue' && (
          <View style={[S.resultBox, { backgroundColor: '#fff5f5', borderColor: '#ffcccc' }]}>
            <Text style={[S.resultBoxTxt, { color: '#c0392b' }]}>
              ⚠️ All {maxR} reminder{maxR !== 1 ? 's' : ''} sent. Your caregiver has been notified.
              You can still respond below.
            </Text>
            <View style={[S.actionRow, { marginTop: 10 }]}>
              <TouchableOpacity style={[S.takenBtn, { flex: 1 }]} onPress={() => onTaken(item)}>
                <Text style={S.takenBtnTxt}>✅  Taken</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.partialBtn, { flex: 1 }]} onPress={() => onPartial(item)}>
                <Text style={S.partialBtnTxt}>💊  Partial</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {vs === 'taken' && (
          <View style={[S.resultBox, { backgroundColor: '#f0fff8', borderColor: '#b2dfdb' }]}>
            <Text style={[S.resultBoxTxt, { color: '#27ae60', fontWeight: '700' }]}>
              ✅ Great job! Marked as taken
              {item.actual_taken_at ? ` at ${fmtDateTime(item.actual_taken_at)}` : ''}.
              {item.response_note ? ` "${item.response_note}"` : ''}
            </Text>
          </View>
        )}

        {/* Action buttons for active states */}
        {(vs === 'pending' || vs === 'reminded' || vs === 'snoozed') && (
          <>
            <View style={S.actionRow}>
              <TouchableOpacity style={[S.takenBtn, { flex: 2 }]} onPress={() => onTaken(item)}>
                <Text style={S.takenBtnTxt}>✅  Taken</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.partialBtn, { flex: 1.5 }]} onPress={() => onPartial(item)}>
                <Text style={S.partialBtnTxt}>💊  Partial</Text>
              </TouchableOpacity>
            </View>
            <View style={[S.actionRow, { marginTop: 8 }]}>
              <TouchableOpacity style={[S.snoozeBtn, { flex: 1.5 }]} onPress={() => onSnooze(item)}>
                <Text style={S.snoozeBtnTxt}>😴  Snooze</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.notTakenBtn, { flex: 1.5 }]} onPress={() => onNotTaken(item)}>
                <Text style={S.notTakenBtnTxt}>❌  Not Taken</Text>
              </TouchableOpacity>
            </View>
            {vs !== 'snoozed' && (
              <Text style={S.notTakenHint}>
                Tap "Not Taken" and you'll be reminded again at {nextReminderLabel}.
              </Text>
            )}
          </>
        )}
      </View>
    </View>
  );
};

const StateBadge = ({ color, bg, icon, label }: { color: string; bg: string; icon: string; label: string }) => (
  <View style={[S.stateBadge, { backgroundColor: bg }]}>
    <Text style={[S.stateBadgeTxt, { color }]}>{icon} {label}</Text>
  </View>
);

const InfoBox = ({ color, bg, border, children }: { color: string; bg: string; border: string; children: React.ReactNode }) => (
  <View style={[S.infoBox, { backgroundColor: bg, borderColor: border }]}>
    <Text style={[S.infoBoxTxt, { color }]}>{children}</Text>
  </View>
);

// =============================================================================
// Main Screen
// =============================================================================
const TodayRemindersScreen = ({ navigation }: any) => {
  const [elder,      setElder]      = useState<any>(null);
  const [items,      setItems]      = useState<ScheduleItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [activeItem,  setActiveItem]  = useState<ScheduleItem | null>(null);
  const [actionMode,  setActionMode]  = useState<ActionMode>(null);
  const [note,        setNote]        = useState('');
  const [partialDose, setPartialDose] = useState('');
  const [snoozeMin,   setSnoozeMin]   = useState(30);
  const [submitting,  setSubmitting]  = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          setElder(user);
          await load(user.id);
          await registerForPushNotifications(user.id);
        }
      } catch (e) { console.log('Init error', e); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.screen === 'TodayReminders' && elder?.id) load(elder.id);
    });
    return () => sub.remove();
  }, [elder?.id]);

  useEffect(() => {
    if (!elder?.id) return;
    pollRef.current = setInterval(() => load(elder.id, true), 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [elder?.id]);

  const load = useCallback(async (elderId: number, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res  = await fetch(getApiUrl(`/api/schedules/today/${elderId}`));
      const data = await res.json();

      const STATE_ORDER: Record<VisualState, number> = {
        overdue: 0, reminded: 1, pending: 2, snoozed: 3,
        not_taken: 4, partial: 5, upcoming: 6, taken: 7,
      };

      const sorted = (Array.isArray(data) ? data : []).sort((a: ScheduleItem, b: ScheduleItem) => {
        const va = computeVisualState(a);
        const vb = computeVisualState(b);
        if (STATE_ORDER[va] !== STATE_ORDER[vb]) return STATE_ORDER[va] - STATE_ORDER[vb];
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });

      setItems(sorted);
    } catch (e) { console.log('Load error', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const onRefresh = () => { setRefreshing(true); if (elder?.id) load(elder.id); };

  const openModal = (item: ScheduleItem, mode: ActionMode) => {
    setActiveItem(item);
    setActionMode(mode);
    setNote('');
    setPartialDose('');
    setSnoozeMin(30);
  };

  const closeModal = () => {
    setActiveItem(null);
    setActionMode(null);
    setNote('');
    setPartialDose('');
  };

  const submitResponse = async (status: string) => {
    if (!activeItem || !elder) return;
    setSubmitting(true);
    try {
      const body: any = {
        scheduleId:    activeItem.id,
        elderId:       elder.id,
        status,
        responseNote:  note.trim() || null,
        scheduledDate: new Date().toISOString().split('T')[0],
      };
      if (status === 'partial') body.partialDose = partialDose.trim() || null;
      if (status === 'snooze')  body.snoozeDuration = snoozeMin;

      const res = await fetch(getApiUrl('/api/schedules/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { Alert.alert('Error', 'Failed to submit response.'); return; }
      closeModal();
      await load(elder.id);
    } catch { Alert.alert('Error', 'Please try again.'); }
    finally { setSubmitting(false); }
  };

  // Quick not-taken (no modal)
  const quickNotTaken = async (item: ScheduleItem) => {
    if (!elder) return;
    try {
      await fetch(getApiUrl('/api/schedules/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId:    item.id,
          elderId:       elder.id,
          status:        'not_taken',
          responseNote:  null,
          scheduledDate: new Date().toISOString().split('T')[0],
        }),
      });
      await load(elder.id);
    } catch { Alert.alert('Error', 'Please try again.'); }
  };

  const visualStates = items.map(computeVisualState);
  const countOf = (vs: VisualState) => visualStates.filter(v => v === vs).length;
  const numOverdue  = countOf('overdue');
  const numPending  = countOf('pending') + countOf('reminded') + countOf('not_taken') + countOf('snoozed');
  const numUpcoming = countOf('upcoming');
  const numTaken    = countOf('taken') + countOf('partial');
  const total       = items.length;

  const pillData = [
    { num: numUpcoming, label: 'Upcoming', bg: '#e8f4ff', clr: '#0984e3' },
    { num: numPending,  label: 'Pending',  bg: '#fff3e6', clr: '#e17055' },
    { num: numTaken,    label: 'Done',     bg: '#d4faf0', clr: '#27ae60' },
    { num: numOverdue,  label: 'Overdue',  bg: numOverdue > 0 ? '#ffe0e0' : '#f0f0f0', clr: '#c0392b' },
  ];

  return (
    <SafeAreaView style={S.screen}>

      {/* Header */}
      <View style={S.header}>
        <View>
          <Text style={S.headerDate}>{todayLabel()}</Text>
          <Text style={S.headerTitle}>Today's Schedule</Text>
        </View>
        {numOverdue > 0
          ? <View style={[S.headerBadge, { backgroundColor: '#ffe0e0' }]}>
              <Text style={[S.headerBadgeNum, { color: '#c0392b' }]}>{numOverdue}</Text>
              <Text style={[S.headerBadgeLbl, { color: '#c0392b' }]}>overdue</Text>
            </View>
          : <View style={S.headerBadge}>
              <Text style={S.headerBadgeNum}>{numPending}</Text>
              <Text style={S.headerBadgeLbl}>pending</Text>
            </View>
        }
      </View>

      {/* Progress bar */}
      {total > 0 && (
        <View style={S.progressWrap}>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${Math.round((numTaken / total) * 100)}%` as any }]} />
          </View>
          <Text style={S.progressTxt}>
            {numTaken}/{total} done · {numUpcoming} upcoming · {numOverdue} overdue
          </Text>
        </View>
      )}

      {/* Summary pills */}
      <View style={S.pillRow}>
        {pillData.map(p => (
          <View key={p.label} style={[S.pill, { backgroundColor: p.bg }]}>
            <Text style={[S.pillNum, { color: p.clr }]}>{p.num}</Text>
            <Text style={S.pillLbl}>{p.label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={S.loadTxt}>Loading today's schedule…</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {items.length === 0 ? (
            <View style={S.empty}>
              <Text style={S.emptyIco}>🎉</Text>
              <Text style={S.emptyTitle}>Nothing scheduled today</Text>
              <Text style={S.emptyTxt}>Your caregiver hasn't scheduled any tasks yet.</Text>
            </View>
          ) : (
            items.map(item => (
              <ScheduleCard
                key={item.id}
                item={item}
                onTaken={i  => openModal(i, 'taken')}
                onPartial={i => openModal(i, 'partial')}
                onSnooze={i  => openModal(i, 'snooze')}
                onNotTaken={i => quickNotTaken(i)}
              />
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Action Modal */}
      {activeItem && actionMode && (
        <Modal visible transparent animationType="slide">
          <View style={S.modalOverlay}>
            <View style={S.modalBox}>

              {/* Overdue tag */}
              {computeVisualState(activeItem) === 'overdue' && (
                <View style={S.modalOverdueTag}>
                  <Text style={S.modalOverdueTagTxt}>🚨 Overdue Task</Text>
                </View>
              )}

              <Text style={S.modalTitle}>
                {TYPE_CONFIG[activeItem.type].icon}  {activeItem.title}
              </Text>
              {activeItem.dosage && <Text style={S.modalDosage}>💊 {activeItem.dosage}</Text>}
              {(activeItem.reminded_count || 0) > 0 && (
                <View style={S.modalInfoRow}>
                  <Text style={S.modalInfoTxt}>
                    🔔 Reminded {activeItem.reminded_count}/{activeItem.max_reminders} times
                  </Text>
                </View>
              )}

              {/* TAKEN mode */}
              {actionMode === 'taken' && (
                <>
                  <Text style={S.modalPrompt}>Add a note (optional)</Text>
                  <TextInput
                    style={S.modalInput}
                    value={note}
                    onChangeText={setNote}
                    placeholder="e.g. Took with meal, felt fine…"
                    placeholderTextColor={colors.textSecondary}
                    multiline
                  />
                  <View style={S.modalBtns}>
                    <TouchableOpacity style={S.modalTakenBtn} onPress={() => submitResponse('done')} disabled={submitting}>
                      {submitting ? <ActivityIndicator color="#fff" /> : <Text style={S.modalTakenBtnTxt}>✅  Yes, I took it!</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={S.modalCancelBtn} onPress={closeModal} disabled={submitting}>
                      <Text style={S.modalCancelBtnTxt}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* PARTIAL mode */}
              {actionMode === 'partial' && (
                <>
                  <Text style={S.modalPrompt}>How much did you take?</Text>
                  <TextInput
                    style={S.modalInput}
                    value={partialDose}
                    onChangeText={setPartialDose}
                    placeholder="e.g. Half a tablet, 5ml…"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={S.modalPrompt}>Additional note (optional)</Text>
                  <TextInput
                    style={[S.modalInput, { minHeight: 60 }]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="e.g. Felt nauseous, took half…"
                    placeholderTextColor={colors.textSecondary}
                    multiline
                  />
                  <View style={S.modalBtns}>
                    <TouchableOpacity
                      style={[S.modalTakenBtn, { backgroundColor: '#8e44ad' }]}
                      onPress={() => submitResponse('partial')}
                      disabled={submitting}>
                      {submitting ? <ActivityIndicator color="#fff" /> : <Text style={S.modalTakenBtnTxt}>💊  Log Partial Dose</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={S.modalCancelBtn} onPress={closeModal} disabled={submitting}>
                      <Text style={S.modalCancelBtnTxt}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* SNOOZE mode */}
              {actionMode === 'snooze' && (
                <>
                  <Text style={S.modalPrompt}>Remind me again in:</Text>
                  <View style={S.snoozeGrid}>
                    {SNOOZE_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[S.snoozeOption, snoozeMin === opt.value && S.snoozeOptionActive]}
                        onPress={() => setSnoozeMin(opt.value)}>
                        <Text style={[S.snoozeOptionTxt, snoozeMin === opt.value && S.snoozeOptionTxtActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={S.modalBtns}>
                    <TouchableOpacity
                      style={[S.modalTakenBtn, { backgroundColor: '#2980b9' }]}
                      onPress={() => submitResponse('snooze')}
                      disabled={submitting}>
                      {submitting ? <ActivityIndicator color="#fff" /> : <Text style={S.modalTakenBtnTxt}>😴  Snooze for {snoozeMin} min</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={S.modalCancelBtn} onPress={closeModal} disabled={submitting}>
                      <Text style={S.modalCancelBtnTxt}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

// =============================================================================
// Styles
// =============================================================================
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerDate:     { fontSize: 12, color: colors.textSecondary },
  headerTitle:    { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  headerBadge:    { alignItems: 'center', backgroundColor: '#fff3e6', padding: 10, borderRadius: 12 },
  headerBadgeNum: { fontSize: 22, fontWeight: '800', color: '#e17055' },
  headerBadgeLbl: { fontSize: 10, color: '#e17055' },

  progressWrap:  { backgroundColor: colors.white, paddingHorizontal: 20, paddingBottom: 10, paddingTop: 6 },
  progressTrack: { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%' as any, backgroundColor: '#27ae60', borderRadius: 3 },
  progressTxt:   { fontSize: 11, color: colors.textSecondary, marginTop: 4 },

  pillRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  pill:    { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12 },
  pillNum: { fontSize: 18, fontWeight: '800' },
  pillLbl: { fontSize: 10, color: colors.textSecondary, marginTop: 1 },

  center:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadTxt:    { marginTop: 12, color: colors.textSecondary },
  empty:      { alignItems: 'center', paddingVertical: 80, paddingHorizontal: 40 },
  emptyIco:   { fontSize: 72, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  emptyTxt:   { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  card:         { backgroundColor: colors.white, marginHorizontal: 16, marginTop: 10, borderRadius: 16, borderLeftWidth: 5, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  cardTaken:    { opacity: 0.78 },
  cardPartial:  { borderWidth: 1, borderColor: '#d6b8ff', borderLeftWidth: 5 },
  cardNotTaken: { borderWidth: 1, borderColor: '#ffccbb', borderLeftWidth: 5 },
  cardOverdue:  { borderWidth: 1, borderColor: '#c0392b', borderLeftWidth: 5 },
  cardSnoozed:  { borderWidth: 1, borderColor: '#bee8ff', borderLeftWidth: 5 },
  cardUpcoming: { opacity: 0.85 },

  timeBadge:    { paddingVertical: 6, paddingHorizontal: 14, alignSelf: 'flex-start' },
  timeBadgeTxt: { fontSize: 13, color: '#fff', fontWeight: '700' },
  cardBody:     { padding: 14 },
  cardTop:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 },

  typePill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typePillTxt: { fontSize: 11, fontWeight: '700' },
  stateBadge:    { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  stateBadgeTxt: { fontSize: 11, fontWeight: '700' },

  cardTitle:      { fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginBottom: 3 },
  cardTitleFaded: { color: colors.textSecondary },
  cardDosage:     { fontSize: 13, color: '#7c6fcd', fontWeight: '600', marginBottom: 3 },
  cardDesc:       { fontSize: 13, color: colors.textSecondary, marginBottom: 6, lineHeight: 18 },
  cardCG:         { fontSize: 11, color: colors.textSecondary, marginTop: 4 },

  infoBox:    { borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1 },
  infoBoxTxt: { fontSize: 12, lineHeight: 18 },

  resultBox:    { borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1 },
  resultBoxTxt: { fontSize: 12, lineHeight: 18 },

  actionRow:      { flexDirection: 'row', gap: 8, marginTop: 12 },
  takenBtn:       { flex: 2, backgroundColor: '#27ae60', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  takenBtnTxt:    { color: '#fff', fontSize: 14, fontWeight: '700' },
  partialBtn:     { flex: 1.5, backgroundColor: '#f3e5ff', paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#d6b8ff' },
  partialBtnTxt:  { color: '#8e44ad', fontSize: 13, fontWeight: '700' },
  snoozeBtn:      { flex: 1.5, backgroundColor: '#e8f4fd', paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#bee8ff' },
  snoozeBtnTxt:   { color: '#2980b9', fontSize: 13, fontWeight: '700' },
  notTakenBtn:    { flex: 1.5, backgroundColor: '#fff0eb', paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#ffb3a7' },
  notTakenBtnTxt: { color: '#e17055', fontSize: 13, fontWeight: '700' },
  notTakenHint:   { fontSize: 11, color: colors.textSecondary, marginTop: 6, textAlign: 'center', fontStyle: 'italic' },

  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:          { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalOverdueTag:   { backgroundColor: '#ffe0e0', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 8 },
  modalOverdueTagTxt:{ fontSize: 12, fontWeight: '800', color: '#c0392b' },
  modalTitle:        { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
  modalDosage:       { fontSize: 13, color: '#7c6fcd', fontWeight: '600', marginBottom: 8 },
  modalInfoRow:      { backgroundColor: '#fff8e1', borderRadius: 8, padding: 8, marginBottom: 10 },
  modalInfoTxt:      { fontSize: 12, color: '#e67e22', fontWeight: '600' },
  modalPrompt:       { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: 4 },
  modalInput:        { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 14, color: colors.textPrimary, minHeight: 80, textAlignVertical: 'top', marginBottom: 16 },
  modalBtns:         { gap: 10 },
  modalTakenBtn:     { backgroundColor: '#27ae60', paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  modalTakenBtnTxt:  { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalCancelBtn:    { paddingVertical: 10, alignItems: 'center' },
  modalCancelBtnTxt: { color: colors.textSecondary, fontSize: 14 },

  snoozeGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  snoozeOption:       { flex: 1, minWidth: '45%', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.white },
  snoozeOptionActive: { backgroundColor: '#2980b9', borderColor: '#2980b9' },
  snoozeOptionTxt:    { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  snoozeOptionTxtActive: { color: '#fff' },
});

export default TodayRemindersScreen;