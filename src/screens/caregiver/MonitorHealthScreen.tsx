import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

// =============================================================================
// TYPES
// =============================================================================

interface HealthLog {
  id: number; log_type: string; value: string;
  unit: string; notes: string; logged_at: string;
}
interface HealthRisk {
  id: number; risk_type: string; log_type: string;
  severity: string; message: string; readings_count: number; detected_at: string;
}

/**
 * TodayItem — one scheduled medication/task for today, with its live visual state.
 * Comes from GET /api/schedules/today/caregiver/:caregiverId (new endpoint)
 *
 * visual_state computed server-side:
 *   upcoming   scheduled_time > now, no intake row
 *   pending    scheduled_time <= now, 0 reminders sent
 *   reminded   1+ reminders sent, no response yet
 *   snoozed    intake.status=snoozed AND snooze_until > now
 *   not_taken  intake.status=not_taken
 *   partial    intake.status=partial (terminal)
 *   taken      intake.status=taken   (terminal)
 *   overdue    intake.is_overdue=1
 */
type VisualState = 'upcoming' | 'pending' | 'reminded' | 'snoozed'
                 | 'not_taken' | 'partial' | 'taken' | 'overdue';

interface TodayItem {
  id:              number;
  elder_id:        number;
  elder_name:      string;
  type:            string;
  title:           string;
  description?:    string;
  dosage?:         string;
  scheduled_time:  string;
  repeat_interval: number;
  max_reminders:   number;
  log_id?:         number;
  intake_status?:  string;
  is_overdue:      number;
  reminded_count:  number;
  snooze_until?:   string | null;
  snooze_count:    number;
  partial_dose?:   string | null;
  actual_taken_at?: string | null;
  response_note?:  string | null;
  visual_state:    VisualState;
}

/**
 * ActivityItem — event row from the history feed.
 * Comes from GET /api/medication-activity/caregiver/:caregiverId
 */
interface ActivityItem {
  source:           'intake' | 'reminder';
  id:               number;
  medication_id:    number;
  elder_id:         number;
  elder_name?:      string;
  title:            string;
  type:             string;
  scheduled_time:   string;
  dosage?:          string;
  status:           string;
  is_overdue:       number;
  response_note?:   string;
  partial_dose?:    string;
  snooze_until?:    string;
  snooze_count?:    number | null;
  actual_taken_at?: string | null;
  event_time:       string;
  attempt_number?:  number;
  is_nudge?:        number;
}

type Tab          = 'today' | 'history' | 'vitals' | 'risks' | 'adherence';
type StatusFilter = 'all' | 'upcoming' | 'pending' | 'reminded' | 'snoozed'
                  | 'not_taken' | 'partial' | 'taken' | 'overdue';

// =============================================================================
// STATE META — single source of truth for colors/labels/urgency
// =============================================================================
interface StateMeta {
  icon: string; label: string; color: string; bg: string; border: string;
  isUrgent: boolean; isTerminal: boolean;
}

const STATE_META: Record<VisualState, StateMeta> = {
  upcoming:  { icon: '🕐', label: 'Upcoming',  color: '#0984e3', bg: '#dbeeff', border: '#bee3ff', isUrgent: false, isTerminal: false },
  pending:   { icon: '⏳', label: 'Pending',   color: '#e67e22', bg: '#fff3e6', border: '#ffd3b0', isUrgent: false, isTerminal: false },
  reminded:  { icon: '🔔', label: 'Reminded',  color: '#f39c12', bg: '#fff8e1', border: '#ffeaa7', isUrgent: false, isTerminal: false },
  snoozed:   { icon: '😴', label: 'Snoozed',   color: '#2980b9', bg: '#e8f4fd', border: '#bee8ff', isUrgent: false, isTerminal: false },
  not_taken: { icon: '❌', label: 'Not Taken', color: '#e17055', bg: '#fff5f0', border: '#ffccbb', isUrgent: false, isTerminal: false },
  partial:   { icon: '💊', label: 'Partial',   color: '#8e44ad', bg: '#f8f0ff', border: '#d6b8ff', isUrgent: false, isTerminal: true  },
  taken:     { icon: '✅', label: 'Taken',     color: '#27ae60', bg: '#d4faf0', border: '#a8edca', isUrgent: false, isTerminal: true  },
  overdue:   { icon: '🚨', label: 'Overdue',   color: '#c0392b', bg: '#fff0f0', border: '#ffbcbc', isUrgent: true,  isTerminal: false },
};

const STATE_ORDER: Record<VisualState, number> = {
  overdue: 0, reminded: 1, pending: 2, not_taken: 3,
  snoozed: 4, partial: 5, upcoming: 6, taken: 7,
};

// Safe accessor — never crashes even if visual_state is undefined/unknown
const getStateMeta = (vs: string | undefined | null): StateMeta =>
  STATE_META[(vs as VisualState) || 'pending'] ?? STATE_META['pending'];

/**
 * The elder's /api/schedules/today/:id endpoint returns `log_status` instead of
 * `visual_state`. This function normalises items from either endpoint so the UI
 * always has a valid `visual_state`.
 */
function normaliseItem(raw: any): TodayItem {
  // Already has a valid visual_state from the caregiver endpoint — use it
  if (raw.visual_state && STATE_META[raw.visual_state as VisualState]) {
    return raw as TodayItem;
  }

  // Derive visual_state from log_status + reminded_count + time (elder endpoint)
  const logStatus     = raw.log_status as string | null;
  const scheduledTime = raw.scheduled_time || '00:00';
  const reminderCount = raw.reminded_count || 0;
  const isOverdue     = raw.is_overdue;

  let visual_state: VisualState;
  if (isOverdue) {
    visual_state = 'overdue';
  } else if (logStatus === 'done') {
    visual_state = 'taken';
  } else if (logStatus === 'partial') {
    visual_state = 'partial';
  } else if (logStatus === 'not_taken' || logStatus === 'skipped') {
    visual_state = 'not_taken';
  } else if (logStatus === 'snoozed' && raw.snooze_until && new Date(raw.snooze_until) > new Date()) {
    visual_state = 'snoozed';
  } else {
    const now = new Date();
    const [hh, mm] = scheduledTime.split(':').map(Number);
    const scheduled = new Date(); scheduled.setHours(hh, mm, 0, 0);
    if (now < scheduled) {
      visual_state = 'upcoming';
    } else {
      visual_state = reminderCount > 0 ? 'reminded' : 'pending';
    }
  }

  return { ...raw, visual_state } as TodayItem;
}

const TYPE_ICONS: Record<string, string> = {
  medicine: '💊', appointment: '🏥', routine: '🌿', reminder: '🔔',
};

// =============================================================================
// FORMATTING
// =============================================================================
const fmtTime = (t: string) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtRelative = (iso: string) => {
  const d   = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)    return 'Just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const fmtDateLabel = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (iso === today.toISOString().split('T')[0])     return 'Today';
  if (iso === yesterday.toISOString().split('T')[0]) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });
}

// =============================================================================
// DATE PICKER
// =============================================================================
const DatePicker = ({ selectedDate, onSelect }: { selectedDate: string; onSelect: (d: string) => void }) => {
  const days = lastNDays(14);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={DP.wrap} contentContainerStyle={DP.row}>
      <TouchableOpacity style={[DP.chip, selectedDate === '' && DP.chipActive]} onPress={() => onSelect('')}>
        <Text style={[DP.chipTxt, selectedDate === '' && DP.chipTxtActive]}>Last 7d</Text>
      </TouchableOpacity>
      {days.map(d => {
        const active = selectedDate === d;
        const date   = new Date(d + 'T12:00:00');
        return (
          <TouchableOpacity key={d} style={[DP.chip, active && DP.chipActive]} onPress={() => onSelect(active ? '' : d)}>
            <Text style={[DP.dayNum, active && DP.chipTxtActive]}>{date.getDate()}</Text>
            <Text style={[DP.dayName, active && DP.chipTxtActive]}>
              {date.toLocaleDateString('en-US', { weekday: 'short' })}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};
const DP = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  row:  { paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: 'row', alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', alignItems: 'center', minWidth: 52 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt:    { fontSize: 12, fontWeight: '700', color: '#636e72' },
  chipTxtActive: { color: '#fff' },
  dayNum:  { fontSize: 16, fontWeight: '800', color: '#2d3436' },
  dayName: { fontSize: 10, color: '#95a5a6', marginTop: 1 },
});

// =============================================================================
// STATUS FILTER BAR
// =============================================================================
const TODAY_FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all',      label: 'All'        },
  { key: 'overdue',  label: '🚨 Overdue'  },
  { key: 'pending',  label: '⏳ Pending'  },
  { key: 'reminded', label: '🔔 Reminded' },
  { key: 'snoozed',  label: '😴 Snoozed'  },
  { key: 'not_taken',label: '❌ Skipped'  },
  { key: 'taken',    label: '✅ Taken'    },
  { key: 'partial',  label: '💊 Partial'  },
  { key: 'upcoming', label: '🕐 Upcoming' },
];

const StatusFilterBar = ({
  active, onChange, counts,
}: {
  active: StatusFilter; onChange: (f: StatusFilter) => void;
  counts: Partial<Record<StatusFilter, number>>;
}) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={FB.wrap} contentContainerStyle={FB.row}>
    {TODAY_FILTER_OPTIONS.map(f => {
      const isActive = active === f.key;
      const meta     = f.key !== 'all' ? STATE_META[f.key as VisualState] : null;
      const color    = meta ? meta.color : '#636e72';
      const count    = counts[f.key];
      return (
        <TouchableOpacity
          key={f.key}
          style={[FB.chip, isActive && { backgroundColor: color, borderColor: color }]}
          onPress={() => onChange(f.key)}>
          <Text style={[FB.txt, isActive && FB.txtActive]}>{f.label}</Text>
          {count !== undefined && count > 0 && (
            <View style={[FB.badge, isActive ? FB.badgeActive : { backgroundColor: color + '22' }]}>
              <Text style={[FB.badgeTxt, { color: isActive ? '#fff' : color }]}>{count}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);
const FB = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  row:  { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', gap: 5 },
  txt:        { fontSize: 12, fontWeight: '700', color: '#636e72' },
  txtActive:  { color: '#fff' },
  badge:      { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  badgeActive:{ backgroundColor: 'rgba(255,255,255,0.3)' },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
});

// =============================================================================
// TODAY ITEM CARD
// =============================================================================
const TodayCard = ({ item }: { item: TodayItem }) => {
  const meta     = getStateMeta(item.visual_state);
  const typeIcon = TYPE_ICONS[item.type] || '📋';

  return (
    <View style={[TC.card, { borderLeftColor: meta.color }, meta.isUrgent && TC.cardUrgent]}>
      {/* Strip */}
      <View style={[TC.strip, { backgroundColor: meta.bg }]}>
        <View style={TC.stripLeft}>
          <View style={[TC.stateBadge, { backgroundColor: meta.color }]}>
            <Text style={TC.stateBadgeTxt}>{meta.icon} {meta.label}</Text>
          </View>
          <Text style={TC.elderName}>👤 {item.elder_name}</Text>
        </View>
        <Text style={TC.timeChip}>{fmtTime(item.scheduled_time)}</Text>
      </View>

      {/* Body */}
      <View style={TC.body}>
        <View style={TC.titleRow}>
          <Text style={TC.typeIcon}>{typeIcon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={TC.title}>{item.title}</Text>
            {item.dosage && <Text style={TC.dosage}>💊 {item.dosage}</Text>}
          </View>
        </View>

        <View style={TC.chips}>
          {item.reminded_count > 0 && (
            <View style={TC.chip}>
              <Text style={TC.chipTxt}>🔔 {item.reminded_count}/{item.max_reminders} reminders</Text>
            </View>
          )}
          {(item.snooze_count ?? 0) > 0 && (
            <View style={TC.chip}>
              <Text style={TC.chipTxt}>😴 Snoozed {item.snooze_count}×</Text>
            </View>
          )}
          {item.actual_taken_at && (
            <View style={TC.chip}>
              <Text style={TC.chipTxt}>
                ✅ {new Date(item.actual_taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          )}
          {item.snooze_until && item.visual_state === 'snoozed' && (
            <View style={TC.chip}>
              <Text style={TC.chipTxt}>
                ⏰ Until {new Date(item.snooze_until).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          )}
        </View>

        {item.partial_dose && (
          <Text style={[TC.note, { color: '#8e44ad' }]}>💊 Partial: {item.partial_dose}</Text>
        )}
        {item.response_note && (
          <Text style={TC.note}>💬 "{item.response_note}"</Text>
        )}

        {/* Overdue attention bar */}
        {meta.isUrgent && (
          <View style={TC.urgentBar}>
            <Text style={TC.urgentTxt}>
              🚨 {item.elder_name} did not respond to {item.reminded_count} reminder{item.reminded_count !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {/* Pending info */}
        {item.visual_state === 'pending' && (
          <View style={TC.infoBar}>
            <Text style={TC.infoTxt}>⏳ Time passed — waiting for reminder to be sent</Text>
          </View>
        )}

        {/* Upcoming info */}
        {item.visual_state === 'upcoming' && (
          <View style={[TC.infoBar, { backgroundColor: '#e8f4ff', borderColor: '#bee3ff' }]}>
            <Text style={[TC.infoTxt, { color: '#0984e3' }]}>
              🕐 Reminder scheduled for {fmtTime(item.scheduled_time)}
            </Text>
          </View>
        )}

        {/* Reminded — show next expected reminder */}
        {item.visual_state === 'reminded' && (
          <View style={TC.infoBar}>
            <Text style={TC.infoTxt}>
              🔔 {item.reminded_count < item.max_reminders
                ? `Reminder ${item.reminded_count}/${item.max_reminders} sent — next in ~${item.repeat_interval} min`
                : `All ${item.max_reminders} reminders sent — no response yet`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};
const TC = StyleSheet.create({
  card:      { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 8, borderRadius: 14, overflow: 'hidden', borderLeftWidth: 4, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  cardUrgent:{ borderWidth: 1, borderColor: '#ffbcbc', borderLeftWidth: 4, elevation: 3, shadowOpacity: 0.12 },
  strip:     { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stripLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  stateBadge:    { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  stateBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },
  elderName: { fontSize: 11, color: '#636e72', fontWeight: '600' },
  timeChip:  { fontSize: 12, fontWeight: '800', color: '#636e72', flexShrink: 0 },
  body:      { padding: 12 },
  titleRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  typeIcon:  { fontSize: 20 },
  title:     { fontSize: 15, fontWeight: '800', color: '#2d3436' },
  dosage:    { fontSize: 12, color: '#7c6fcd', fontWeight: '600', marginTop: 2 },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip:      { backgroundColor: '#f5f6fa', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipTxt:   { fontSize: 11, color: '#636e72', fontWeight: '600' },
  note:      { fontSize: 12, color: '#636e72', marginTop: 4, fontStyle: 'italic' },
  urgentBar: { backgroundColor: '#fff5f5', borderRadius: 8, padding: 8, marginTop: 8, borderWidth: 1, borderColor: '#ffcccc' },
  urgentTxt: { fontSize: 12, color: '#c0392b', fontWeight: '600' },
  infoBar:   { backgroundColor: '#fff8e1', borderRadius: 8, padding: 8, marginTop: 8, borderWidth: 1, borderColor: '#ffeaa7' },
  infoTxt:   { fontSize: 12, color: '#e67e22', fontWeight: '600' },
});

// =============================================================================
// TODAY SCHEDULE FEED
// =============================================================================
const TodayScheduleFeed = ({
  caregiverId, elderId,
}: { caregiverId?: number; elderId?: number }) => {
  const [allItems,     setAllItems]     = useState<TodayItem[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const elderQs = elderId ? `?elderId=${elderId}` : '';
      const url = caregiverId
        ? getApiUrl(`/api/schedules/today/caregiver/${caregiverId}${elderQs}`)
        : getApiUrl(`/api/schedules/today/${elderId}`);
      const res  = await fetch(url);
      const data = await res.json();

      const items: TodayItem[] = (Array.isArray(data) ? data : []).map(normaliseItem);
      items.sort((a, b) => {
        const oa = STATE_ORDER[a.visual_state] ?? 9;
        const ob = STATE_ORDER[b.visual_state] ?? 9;
        if (oa !== ob) return oa - ob;
        return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
      });
      setAllItems(items);
    } catch (e) { console.log('TodayScheduleFeed error:', e); }
    finally { setLoading(false); }
  }, [caregiverId, elderId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    pollRef.current = setInterval(() => load(true), 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const counts = allItems.reduce<Partial<Record<StatusFilter, number>>>((acc, item) => {
    const key = item.visual_state as StatusFilter;
    acc[key]  = (acc[key]  || 0) + 1;
    acc['all']= (acc['all']|| 0) + 1;
    return acc;
  }, {});

  const filtered = statusFilter === 'all'
    ? allItems
    : allItems.filter(i => i.visual_state === statusFilter);

  const urgentCount  = allItems.filter(i => getStateMeta(i.visual_state).isUrgent).length;
  const total        = allItems.length;
  const done         = (counts['taken'] || 0) + (counts['partial'] || 0);
  const actionNeeded = (counts['overdue'] || 0) + (counts['reminded'] || 0) + (counts['pending'] || 0);

  return (
    <View style={{ flex: 1 }}>
      {urgentCount > 0 && (
        <View style={F.urgentBanner}>
          <Text style={F.urgentBannerTxt}>
            🚨 {urgentCount} overdue item{urgentCount !== 1 ? 's' : ''} need your attention
          </Text>
        </View>
      )}

      {total > 0 && (
        <View style={F.progress}>
          <View style={F.progressTrack}>
            <View style={[F.progressFill, { width: `${Math.round((done / total) * 100)}%` as any }]} />
          </View>
          <Text style={F.progressTxt}>
            {done}/{total} completed · {actionNeeded} need action
          </Text>
        </View>
      )}

      <View style={F.pillRow}>
        {[
          { label: 'Total',   num: total,                  bg: '#f5f6fa', clr: '#636e72' },
          { label: 'Done',    num: done,                   bg: '#d4faf0', clr: '#27ae60' },
          { label: 'Pending', num: actionNeeded,            bg: '#fff3e6', clr: '#e67e22' },
          { label: 'Overdue', num: counts['overdue'] || 0, bg: urgentCount > 0 ? '#fff0f0' : '#f5f6fa', clr: '#c0392b' },
        ].map(p => (
          <View key={p.label} style={[F.pill, { backgroundColor: p.bg }]}>
            <Text style={[F.pillNum, { color: p.clr }]}>{p.num}</Text>
            <Text style={F.pillLbl}>{p.label}</Text>
          </View>
        ))}
      </View>

      <StatusFilterBar active={statusFilter} onChange={setStatusFilter} counts={counts} />

      {loading ? (
        <View style={F.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : filtered.length === 0 ? (
        <View style={F.empty}>
          <Text style={F.emptyIco}>
            {statusFilter === 'all' ? '📋' : (STATE_META[statusFilter as VisualState]?.icon ?? '📋')}
          </Text>
          <Text style={F.emptyTxt}>
            {statusFilter === 'all'
              ? 'No medications scheduled for today'
              : `No ${statusFilter.replace('_', ' ')} items`}
          </Text>
        </View>
      ) : (
        <>
          {filtered.map(item => <TodayCard key={`${item.elder_id}-${item.id}`} item={item} />)}
          <View style={{ height: 30 }} />
        </>
      )}
    </View>
  );
};

// =============================================================================
// HISTORY FEED
// =============================================================================
const deriveActivityStatus = (item: ActivityItem) => {
  if (item.source === 'reminder') {
    const nudge = item.is_nudge ? 'Nudge' : 'Auto-reminder';
    if (item.status === 'responded')
      return { icon: '✅', label: `${nudge} — Responded`, color: '#27ae60', bg: '#d4faf0', isUrgent: false };
    return { icon: '🔔', label: `${nudge} sent (${item.attempt_number}×)`, color: '#e67e22', bg: '#fff8e1', isUrgent: false };
  }
  if (item.is_overdue)             return { icon: '🔴', label: 'Overdue',   color: '#c0392b', bg: '#fff0f0', isUrgent: true  };
  if (item.status === 'taken')     return { icon: '✅', label: 'Taken',     color: '#27ae60', bg: '#d4faf0', isUrgent: false };
  if (item.status === 'partial')   return { icon: '💊', label: 'Partial',   color: '#8e44ad', bg: '#f8f0ff', isUrgent: false };
  if (item.status === 'snoozed')   return { icon: '😴', label: 'Snoozed',   color: '#2980b9', bg: '#e8f4fd', isUrgent: false };
  if (item.status === 'not_taken') return { icon: '❌', label: 'Not Taken', color: '#e17055', bg: '#fff5f0', isUrgent: false };
  if (item.status === 'missed')    return { icon: '⚠️', label: 'Missed',    color: '#e17055', bg: '#fff5f0', isUrgent: true  };
  if (item.status === 'pending')   return { icon: '⏳', label: 'Pending',   color: '#e67e22', bg: '#fff3e6', isUrgent: false };
  return { icon: '❓', label: item.status, color: '#95a5a6', bg: '#f0f0f0', isUrgent: false };
};

const ActivityCard = ({ item }: { item: ActivityItem }) => {
  const meta = deriveActivityStatus(item);
  return (
    <View style={[AC.card, { borderLeftColor: meta.color }, meta.isUrgent && AC.cardUrgent]}>
      <View style={[AC.strip, { backgroundColor: meta.bg }]}>
        <View style={AC.stripLeft}>
          <View style={[AC.badge, { backgroundColor: meta.color }]}>
            <Text style={AC.badgeTxt}>{meta.icon} {meta.label}</Text>
          </View>
          {item.elder_name && <Text style={AC.elder}>👤 {item.elder_name}</Text>}
        </View>
        <Text style={AC.time}>{fmtRelative(item.event_time)}</Text>
      </View>
      <View style={AC.body}>
        <View style={AC.titleRow}>
          <Text style={AC.typeIcon}>{TYPE_ICONS[item.type] || '📋'}</Text>
          <Text style={AC.title}>{item.title}</Text>
        </View>
        <View style={AC.chips}>
          {item.dosage && <View style={AC.chip}><Text style={AC.chipTxt}>💊 {item.dosage}</Text></View>}
          <View style={AC.chip}><Text style={AC.chipTxt}>🕐 {fmtTime(item.scheduled_time)}</Text></View>
          {item.attempt_number != null && (
            <View style={AC.chip}>
              <Text style={AC.chipTxt}>{item.is_nudge ? '👋 Nudge' : '🔔 Attempt'} {item.attempt_number}</Text>
            </View>
          )}
          {(item.snooze_count ?? 0) > 0 && (
            <View style={AC.chip}><Text style={AC.chipTxt}>😴 Snoozed {item.snooze_count}×</Text></View>
          )}
        </View>
        {item.partial_dose && <Text style={[AC.note, { color: '#8e44ad' }]}>💊 Partial: {item.partial_dose}</Text>}
        {item.response_note && <Text style={AC.note}>💬 "{item.response_note}"</Text>}
        {item.actual_taken_at && (item.status === 'taken' || item.status === 'partial') && (
          <Text style={[AC.note, { color: '#27ae60' }]}>
            ✅ Taken at {new Date(item.actual_taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </Text>
        )}
        {meta.isUrgent && (
          <View style={AC.urgentBar}>
            <Text style={AC.urgentTxt}>
              {item.is_overdue ? '🚨 Elder did not respond' : '⚠️ Medication was missed'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};
const AC = StyleSheet.create({
  card:      { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 8, borderRadius: 14, overflow: 'hidden', borderLeftWidth: 4, elevation: 1 },
  cardUrgent:{ borderWidth: 1, borderColor: '#ffbcbc', borderLeftWidth: 4, elevation: 3 },
  strip:     { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stripLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  badge:     { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeTxt:  { fontSize: 11, fontWeight: '800', color: '#fff' },
  elder:     { fontSize: 11, color: '#636e72', fontWeight: '600' },
  time:      { fontSize: 11, color: '#95a5a6', flexShrink: 0 },
  body:      { padding: 12 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  typeIcon:  { fontSize: 20 },
  title:     { fontSize: 15, fontWeight: '800', color: '#2d3436', flex: 1 },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip:      { backgroundColor: '#f5f6fa', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipTxt:   { fontSize: 11, color: '#636e72', fontWeight: '600' },
  note:      { fontSize: 12, color: '#636e72', marginTop: 4, fontStyle: 'italic' },
  urgentBar: { backgroundColor: '#fff5f5', borderRadius: 8, padding: 8, marginTop: 8, borderWidth: 1, borderColor: '#ffcccc' },
  urgentTxt: { fontSize: 12, color: '#c0392b', fontWeight: '600' },
});

// HistoryFeed — shows the full schedule picture for any date.
// Uses /api/schedules/date/caregiver/:id?date= for all dates (today + past).
// For "Last 7d" mode it fetches each of the last 7 days and merges them,
// grouped by date with a section header.
const HistoryFeed = ({ caregiverId, elderId }: { caregiverId?: number; elderId?: number }) => {
  const todayISO = new Date().toISOString().split('T')[0];

  // '' = Last 7 days mode, any YYYY-MM-DD = single day mode
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [itemsByDate,  setItemsByDate]  = useState<{ date: string; items: TodayItem[] }[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchForDate = useCallback(async (date: string): Promise<TodayItem[]> => {
    const elderQs = elderId ? `&elderId=${elderId}` : '';
    const url = caregiverId
      ? getApiUrl(`/api/schedules/date/caregiver/${caregiverId}?date=${date}${elderQs}`)
      : getApiUrl(`/api/schedules/today/${elderId}`); // elder uses existing endpoint (today only)
    const res  = await fetch(url);
    const data = await res.json();
    const items: TodayItem[] = (Array.isArray(data) ? data : []).map(normaliseItem);
    items.sort((a, b) => {
      const oa = STATE_ORDER[a.visual_state] ?? 9;
      const ob = STATE_ORDER[b.visual_state] ?? 9;
      if (oa !== ob) return oa - ob;
      return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
    });
    return items;
  }, [caregiverId, elderId]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (selectedDate === '') {
        // Last 7 days — fetch all 7 in parallel
        const dates = lastNDays(7);
        const results = await Promise.all(dates.map(d => fetchForDate(d)));
        const grouped = dates
          .map((d, i) => ({ date: d, items: results[i] }))
          .filter(g => g.items.length > 0); // skip days with nothing scheduled
        setItemsByDate(grouped);
      } else {
        const items = await fetchForDate(selectedDate);
        setItemsByDate([{ date: selectedDate, items }]);
      }
    } catch (e) { console.log('HistoryFeed error:', e); }
    finally { setLoading(false); }
  }, [fetchForDate, selectedDate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    pollRef.current = setInterval(() => load(true), 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Flatten all items for filter counts
  const allItems = itemsByDate.flatMap(g => g.items);

  const counts = allItems.reduce<Partial<Record<StatusFilter, number>>>((acc, item) => {
    const key = item.visual_state as StatusFilter;
    acc[key]  = (acc[key]  || 0) + 1;
    acc['all']= (acc['all']|| 0) + 1;
    return acc;
  }, {});

  const urgentCount  = allItems.filter(i => getStateMeta(i.visual_state).isUrgent).length;
  const total        = allItems.length;
  const done         = (counts['taken'] || 0) + (counts['partial'] || 0);
  const actionNeeded = (counts['overdue'] || 0) + (counts['reminded'] || 0) + (counts['pending'] || 0);

  // Apply status filter across all groups
  const filteredGroups = itemsByDate.map(g => ({
    date:  g.date,
    items: statusFilter === 'all'
      ? g.items
      : g.items.filter(i => i.visual_state === statusFilter),
  })).filter(g => g.items.length > 0);

  return (
    <View style={{ flex: 1 }}>
      {/* Date picker — "Last 7d" chip + individual days */}
      <DatePicker selectedDate={selectedDate} onSelect={d => {
        setStatusFilter('all');
        setSelectedDate(d); // '' = last 7d, YYYY-MM-DD = single day
      }} />

      {/* Urgent banner */}
      {urgentCount > 0 && (
        <View style={F.urgentBanner}>
          <Text style={F.urgentBannerTxt}>
            🚨 {urgentCount} overdue item{urgentCount !== 1 ? 's' : ''} need attention
          </Text>
        </View>
      )}

      {/* Progress + pills (only for single day) */}
      {selectedDate !== '' && total > 0 && (
        <>
          <View style={F.progress}>
            <View style={F.progressTrack}>
              <View style={[F.progressFill, { width: `${Math.round((done / total) * 100)}%` as any }]} />
            </View>
            <Text style={F.progressTxt}>{done}/{total} completed · {actionNeeded} need action</Text>
          </View>
          <View style={F.pillRow}>
            {[
              { label: 'Total',   num: total,                  bg: '#f5f6fa', clr: '#636e72' },
              { label: 'Done',    num: done,                   bg: '#d4faf0', clr: '#27ae60' },
              { label: 'Pending', num: actionNeeded,           bg: '#fff3e6', clr: '#e67e22' },
              { label: 'Overdue', num: counts['overdue'] || 0, bg: urgentCount > 0 ? '#fff0f0' : '#f5f6fa', clr: '#c0392b' },
            ].map(p => (
              <View key={p.label} style={[F.pill, { backgroundColor: p.bg }]}>
                <Text style={[F.pillNum, { color: p.clr }]}>{p.num}</Text>
                <Text style={F.pillLbl}>{p.label}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Filter bar — always shown */}
      <StatusFilterBar active={statusFilter} onChange={setStatusFilter} counts={counts} />

      {/* Period label */}
      <View style={F.periodRow}>
        <Text style={F.periodTxt}>
          {selectedDate === '' ? 'Last 7 days' : fmtDateLabel(selectedDate)}
        </Text>
        <Text style={F.periodCount}>{total} scheduled</Text>
      </View>

      {loading ? (
        <View style={F.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : filteredGroups.length === 0 ? (
        <View style={F.empty}>
          <Text style={F.emptyIco}>
            {statusFilter === 'all' ? '📋' : (STATE_META[statusFilter as VisualState]?.icon ?? '📋')}
          </Text>
          <Text style={F.emptyTxt}>
            {statusFilter === 'all'
              ? 'No medications scheduled'
              : `No ${statusFilter.replace('_', ' ')} items`}
          </Text>
        </View>
      ) : (
        <>
          {filteredGroups.map(group => (
            <View key={group.date}>
              {/* Section header — only shown in multi-day (Last 7d) mode */}
              {selectedDate === '' && (
                <View style={F.sectionHeader}>
                  <Text style={F.sectionHeaderTxt}>{fmtDateLabel(group.date)}</Text>
                  <Text style={F.sectionHeaderCount}>
                    {group.items.filter(i => getStateMeta(i.visual_state).isTerminal).length}/
                    {group.items.length} done
                  </Text>
                </View>
              )}
              {group.items.map(item => (
                <TodayCard key={`${group.date}-${item.elder_id}-${item.id}`} item={item} />
              ))}
            </View>
          ))}
          <View style={{ height: 30 }} />
        </>
      )}
    </View>
  );
};

const F = StyleSheet.create({
  urgentBanner:    { backgroundColor: '#c0392b', paddingVertical: 10, paddingHorizontal: 16 },
  urgentBannerTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  progress:        { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  progressTrack:   { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden' },
  progressFill:    { height: '100%' as any, backgroundColor: '#27ae60', borderRadius: 3 },
  progressTxt:     { fontSize: 11, color: '#636e72', marginTop: 4 },
  pillRow:         { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#f8f9fa', borderBottomWidth: 1, borderBottomColor: '#eee' },
  pill:            { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  pillNum:         { fontSize: 18, fontWeight: '800' },
  pillLbl:         { fontSize: 10, color: '#636e72', marginTop: 1 },
  periodRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f8f9fa' },
  periodTxt:       { fontSize: 12, color: '#636e72', fontWeight: '600' },
  periodCount:     { fontSize: 12, color: '#636e72' },
  center:  { paddingVertical: 60, alignItems: 'center' },
  empty:   { paddingVertical: 60, alignItems: 'center', paddingHorizontal: 40 },
  emptyIco:{ fontSize: 48, marginBottom: 12 },
  emptyTxt:{ fontSize: 14, color: '#95a5a6', textAlign: 'center', lineHeight: 20 },
  sectionHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, backgroundColor: colors.background },
  sectionHeaderTxt:  { fontSize: 13, fontWeight: '800', color: '#2d3436' },
  sectionHeaderCount:{ fontSize: 12, color: '#636e72', fontWeight: '600' },
});

// =============================================================================
// VITALS TAB — self-contained component so it manages its own loading state
// =============================================================================
const VitalsTab = ({ elderId }: { elderId: number }) => {
  const [logs,       setLogs]       = useState<HealthLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res  = await fetch(getApiUrl(`/api/health-logs/${elderId}`));
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) { console.log('VitalsTab error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [elderId]);

  useEffect(() => { load(); }, [load]);

  const fmt = (s: string) => {
    const d   = new Date(s);
    const hrs = Math.floor((Date.now() - d.getTime()) / 3600000);
    if (hrs < 1)  return 'Just now';
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getHealthIcon = (t: string) =>
    ({ blood_pressure: '💉', blood_sugar: '🩸', weight: '⚖️', temperature: '🌡️', heart_rate: '❤️' }[t] || '📊');

  const label = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const getValueColor = (t: string, v: string) => {
    if (t === 'blood_pressure') {
      const sys = parseInt(v.split('/')[0]);
      if (sys > 180) return '#c0392b';
      if (sys > 140) return '#e67e22';
      if (sys < 90)  return '#2980b9';
      return '#27ae60';
    }
    if (t === 'blood_sugar') {
      const n = parseFloat(v);
      if (n < 54 || n > 180) return '#c0392b';
      if (n < 70)            return '#e67e22';
      return '#27ae60';
    }
    if (t === 'heart_rate') {
      const n = parseFloat(v);
      if (n > 130 || n < 50) return '#c0392b';
      if (n > 100 || n < 60) return '#e67e22';
      return '#27ae60';
    }
    if (t === 'temperature') {
      const n = parseFloat(v);
      if (n >= 103)   return '#c0392b';
      if (n >= 100.4) return '#e67e22';
      return '#27ae60';
    }
    return colors.primary;
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {logs.length === 0 ? (
        <Card><Text style={styles.emptyText}>No health logs recorded yet</Text></Card>
      ) : logs.map(log => (
        <Card key={log.id} style={styles.logCard}>
          <View style={styles.logHeader}>
            <Text style={styles.logIcon}>{getHealthIcon(log.log_type)}</Text>
            <View style={styles.logInfo}>
              <Text style={styles.logType}>{label(log.log_type)}</Text>
              <Text style={styles.logDate}>{fmt(log.logged_at)}</Text>
            </View>
            <View style={[styles.logValueBadge, { backgroundColor: getValueColor(log.log_type, log.value) }]}>
              <Text style={styles.logValueText}>{log.value} {log.unit}</Text>
            </View>
          </View>
          {log.notes ? <Text style={styles.logNotes}>💬 {log.notes}</Text> : null}
        </Card>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
};

// =============================================================================
// RISKS TAB — self-contained component
// =============================================================================
const RisksTab = ({ elderId }: { elderId: number }) => {
  const [risks,      setRisks]      = useState<HealthRisk[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res  = await fetch(getApiUrl(`/api/health-risks/${elderId}`));
      const data = await res.json();
      setRisks(Array.isArray(data) ? data : []);
    } catch (e) { console.log('RisksTab error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [elderId]);

  useEffect(() => { load(); }, [load]);

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return { bg: '#fff0f0', border: '#c0392b', text: '#c0392b', label: '🚨 CRITICAL' };
      case 'danger':   return { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ DANGER'   };
      default:         return { bg: '#fffdf0', border: '#e67e22', text: '#856404', label: '⚠️ WARNING'  };
    }
  };

  const fmt = (s: string) => {
    const d   = new Date(s);
    const hrs = Math.floor((Date.now() - d.getTime()) / 3600000);
    if (hrs < 1)  return 'Just now';
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {risks.length === 0 ? (
        <Card style={styles.noRisksCard}>
          <Text style={styles.noRisksIcon}>✅</Text>
          <Text style={styles.noRisksTitle}>No active health risks</Text>
          <Text style={styles.noRisksText}>
            All vital signs appear within normal ranges. Risks trigger when 3+ abnormal readings occur within 3 days.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={styles.riskLegendCard}>
            <Text style={styles.riskLegendText}>ℹ️ Risks are triggered when abnormal readings repeat over 3 days.</Text>
          </Card>
          {risks.map(risk => {
            const s = getSeverityStyle(risk.severity);
            return (
              <View key={risk.id} style={[styles.riskCard, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                <View style={styles.riskCardHeader}>
                  <Text style={[styles.riskSeverity, { color: s.text }]}>{s.label}</Text>
                  <Text style={styles.riskCardDate}>{fmt(risk.detected_at)}</Text>
                </View>
                <Text style={styles.riskCardMessage}>{risk.message}</Text>
                <Text style={styles.riskCardReadings}>📊 {risk.readings_count} readings analyzed</Text>
              </View>
            );
          })}
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
};

// =============================================================================
// ADHERENCE TAB — shows 7-day adherence for caregiver's elders or single elder
// =============================================================================
interface MedSummary {
  id: number; title: string; type: string; scheduled_time: string;
  days_due: number; days_taken: number; days_partial: number; days_missed: number;
  adherence_pct: number;
}
interface ElderAdherence {
  elder_id: number; elder_name?: string;
  overall_pct: number | null; total_meds: number;
  critical_meds: number; warning_meds: number;
  worst_med: MedSummary | null; medications: MedSummary[];
}

const adherenceColor = (pct: number | null) => {
  if (pct === null) return '#95a5a6';
  if (pct >= 90) return '#27ae60';
  if (pct >= 70) return '#0984e3';
  if (pct >= 50) return '#e67e22';
  return '#c0392b';
};
const adherenceLabel2 = (pct: number | null) => {
  if (pct === null) return 'No Data';
  if (pct >= 90) return '🏆 Excellent';
  if (pct >= 70) return '👍 Good';
  if (pct >= 50) return '⚠️ Attention';
  return '🚨 Critical';
};

// Mini ring (pure border trick)
const MiniRing = ({ pct, size = 64 }: { pct: number | null; size?: number }) => {
  const color = adherenceColor(pct);
  const filled = pct ?? 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 6, borderColor: '#f0f2f5' }} />
      <View style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 6, borderColor: 'transparent',
        borderTopColor: color,
        borderRightColor: filled > 25 ? color : 'transparent',
        borderBottomColor: filled > 50 ? color : 'transparent',
        borderLeftColor: filled > 75 ? color : 'transparent',
        transform: [{ rotate: '-90deg' }],
      }} />
      <Text style={{ fontSize: size * 0.22, fontWeight: '800', color }}>{pct !== null && !isNaN(pct) ? `${pct}%` : '—'}</Text>
    </View>
  );
};

const AdherenceTab = ({
  caregiverId, elderId, elderName,
}: { caregiverId?: number; elderId?: number; elderName?: string }) => {
  const [elders,     setElders]     = useState<ElderAdherence[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [periodDays, setPeriodDays] = useState(7);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (caregiverId && !elderId) {
        // Caregiver mode — fetch summary for all connected elders
        const connRes  = await fetch(getApiUrl(`/api/connections/${caregiverId}`));
        const connData = await connRes.json();
        const elderList: { id: number; name: string }[] = Array.isArray(connData) ? connData : [];
        if (!elderList.length) { setElders([]); return; }

        const summaries = await Promise.all(
          elderList.map(async e => {
            try {
              const r = await fetch(getApiUrl(`/api/adherence/summary/${e.id}?days=${periodDays}`));
              const d = await r.json();
              return { ...d, elder_name: e.name } as ElderAdherence;
            } catch { return { elder_id: e.id, elder_name: e.name, overall_pct: null, total_meds: 0, critical_meds: 0, warning_meds: 0, worst_med: null, medications: [] } as ElderAdherence; }
          })
        );
        // Sort: critical first
        summaries.sort((a, b) => {
          const pa = a.overall_pct ?? 101, pb = b.overall_pct ?? 101;
          return pa - pb;
        });
        setElders(summaries);
      } else if (elderId) {
        // Elder or caregiver viewing a specific elder
        const r = await fetch(getApiUrl(`/api/adherence/summary/${elderId}?days=${periodDays}`));
        const d = await r.json();
        setElders([{ ...d, elder_name: elderName || '' }]);
      }
    } catch (e) { console.log('AdherenceTab error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [caregiverId, elderId, periodDays]);

  useEffect(() => { load(); }, [load]);

  const totalElders   = elders.length;
  const criticalCount = elders.filter(e => (e.overall_pct ?? 100) < 50).length;
  const warningCount  = elders.filter(e => (e.overall_pct ?? 100) >= 50 && (e.overall_pct ?? 100) < 70).length;
  const validElders   = elders.filter(e => e.overall_pct !== null && !isNaN(e.overall_pct!));
  const avgPct        = validElders.length > 0
    ? Math.round(validElders.reduce((s, e) => s + e.overall_pct!, 0) / validElders.length)
    : null;

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.primary} />}
    >
      {/* Period selector */}
      <View style={ADH.periodRow}>
        {[{ d: 7, l: '7 days' }, { d: 14, l: '14 days' }, { d: 30, l: '30 days' }].map(p => (
          <TouchableOpacity key={p.d}
            style={[ADH.periodBtn, periodDays === p.d && ADH.periodBtnActive]}
            onPress={() => setPeriodDays(p.d)}>
            <Text style={[ADH.periodBtnTxt, periodDays === p.d && ADH.periodBtnTxtActive]}>{p.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary banner (caregiver-mode only) */}
      {caregiverId && !elderId && totalElders > 0 && (
        <View style={ADH.summaryBanner}>
          <View style={ADH.summaryBannerLeft}>
            <MiniRing pct={avgPct} size={72} />
          </View>
          <View style={ADH.summaryBannerRight}>
            <Text style={ADH.summaryBannerTitle}>Average {periodDays}-Day Adherence</Text>
            <Text style={[ADH.summaryBannerPct, { color: adherenceColor(avgPct) }]}>{adherenceLabel2(avgPct)}</Text>
            <View style={ADH.summaryStats}>
              <View style={[ADH.summaryStat, { backgroundColor: '#fff0f0' }]}>
                <Text style={[ADH.summaryStatNum, { color: '#c0392b' }]}>{criticalCount}</Text>
                <Text style={ADH.summaryStatLbl}>Critical</Text>
              </View>
              <View style={[ADH.summaryStat, { backgroundColor: '#fff3e6' }]}>
                <Text style={[ADH.summaryStatNum, { color: '#e67e22' }]}>{warningCount}</Text>
                <Text style={ADH.summaryStatLbl}>Warning</Text>
              </View>
              <View style={[ADH.summaryStat, { backgroundColor: '#d4faf0' }]}>
                <Text style={[ADH.summaryStatNum, { color: '#27ae60' }]}>{totalElders - criticalCount - warningCount}</Text>
                <Text style={ADH.summaryStatLbl}>On Track</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {loading ? (
        <View style={ADH.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : elders.length === 0 ? (
        <View style={ADH.empty}>
          <Text style={ADH.emptyIco}>📊</Text>
          <Text style={ADH.emptyTxt}>No adherence data available yet</Text>
        </View>
      ) : (
        elders.map(elder => {
          const color    = adherenceColor(elder.overall_pct);
          const label    = adherenceLabel2(elder.overall_pct);
          const expanded = expandedId === elder.elder_id;
          const isCrit   = (elder.overall_pct ?? 100) < 50;
          const isWarn   = !isCrit && (elder.overall_pct ?? 100) < 70;

          return (
            <TouchableOpacity
              key={elder.elder_id}
              activeOpacity={0.85}
              style={[ADH.elderCard, { borderLeftColor: color }, isCrit && ADH.elderCardCritical, isWarn && ADH.elderCardWarning]}
              onPress={() => setExpandedId(expanded ? null : elder.elder_id)}>

              {/* Header row */}
              <View style={ADH.elderCardTop}>
                <MiniRing pct={elder.overall_pct} size={60} />
                <View style={ADH.elderCardInfo}>
                  {elder.elder_name ? <Text style={ADH.elderCardName}>👤 {elder.elder_name}</Text> : null}
                  <View style={[ADH.labelBadge, { backgroundColor: color + '22' }]}>
                    <Text style={[ADH.labelBadgeTxt, { color }]}>{label}</Text>
                  </View>
                  <Text style={ADH.elderCardSub}>
                    {elder.total_meds} med{elder.total_meds !== 1 ? 's' : ''} · {periodDays}-day window
                  </Text>
                  {elder.critical_meds > 0 && (
                    <Text style={ADH.critAlert}>🚨 {elder.critical_meds} med{elder.critical_meds !== 1 ? 's' : ''} below 50%</Text>
                  )}
                </View>
                <Text style={ADH.expandHint}>{expanded ? '▲' : '▼'}</Text>
              </View>

              {/* Per-medication breakdown when expanded */}
              {expanded && elder.medications.length > 0 && (
                <View style={ADH.medsBox}>
                  <Text style={ADH.medsBoxTitle}>Medication Breakdown</Text>
                  {elder.medications.map(med => {
                    const mc = adherenceColor(med.adherence_pct);
                    return (
                      <View key={med.id} style={ADH.medRow}>
                        <View style={ADH.medRowLeft}>
                          <Text style={ADH.medRowIcon}>
                            {med.type === 'medicine' ? '💊' : med.type === 'appointment' ? '🏥' : med.type === 'routine' ? '🌿' : '🔔'}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={ADH.medRowTitle} numberOfLines={1}>{med.title}</Text>
                            <Text style={ADH.medRowTime}>🕐 {fmtTime(med.scheduled_time)} · {med.days_taken}✅ {med.days_partial > 0 ? `${med.days_partial}💊 ` : ''}{med.days_missed}❌ / {med.days_due} due</Text>
                          </View>
                        </View>
                        <View style={[ADH.medPctBadge, { backgroundColor: mc + '22' }]}>
                          <Text style={[ADH.medPctTxt, { color: mc }]}>{isNaN(med.adherence_pct) ? '—' : `${med.adherence_pct}%`}</Text>
                        </View>
                      </View>
                    );
                  })}

                  {/* Worst performing */}
                  {elder.worst_med && elder.worst_med.adherence_pct < 80 && (
                    <View style={ADH.worstAlert}>
                      <Text style={ADH.worstAlertTxt}>
                        ⚠️ Lowest adherence: "{elder.worst_med.title}" at {elder.worst_med.adherence_pct}%
                        ({elder.worst_med.days_missed} missed / {elder.worst_med.days_due} due)
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const ADH = StyleSheet.create({
  periodRow:    { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  periodBtn:    { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff' },
  periodBtnActive:  { backgroundColor: colors.primary, borderColor: colors.primary },
  periodBtnTxt:     { fontSize: 12, fontWeight: '700', color: '#636e72' },
  periodBtnTxtActive: { color: '#fff' },

  summaryBanner:      { flexDirection: 'row', backgroundColor: '#fff', margin: 12, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#eee', elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  summaryBannerLeft:  { marginRight: 16, justifyContent: 'center' },
  summaryBannerRight: { flex: 1, justifyContent: 'center', gap: 4 },
  summaryBannerTitle: { fontSize: 11, color: '#636e72', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryBannerPct:   { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  summaryStats:       { flexDirection: 'row', gap: 6 },
  summaryStat:        { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  summaryStatNum:     { fontSize: 18, fontWeight: '800' },
  summaryStatLbl:     { fontSize: 9, color: '#636e72', fontWeight: '600', marginTop: 1 },

  center: { paddingVertical: 60, alignItems: 'center' },
  empty:  { paddingVertical: 60, alignItems: 'center', paddingHorizontal: 40 },
  emptyIco: { fontSize: 48, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#95a5a6', textAlign: 'center' },

  elderCard:         { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 10, marginTop: 4, borderRadius: 14, padding: 14, borderLeftWidth: 5, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  elderCardCritical: { borderWidth: 1, borderColor: '#c0392b', borderLeftWidth: 5 },
  elderCardWarning:  { borderWidth: 1, borderColor: '#e67e22', borderLeftWidth: 5 },
  elderCardTop:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  elderCardInfo:     { flex: 1, gap: 4 },
  elderCardName:     { fontSize: 15, fontWeight: '800', color: '#2d3436' },
  elderCardSub:      { fontSize: 11, color: '#636e72' },
  labelBadge:        { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start' },
  labelBadgeTxt:     { fontSize: 11, fontWeight: '800' },
  critAlert:         { fontSize: 11, color: '#c0392b', fontWeight: '700' },
  expandHint:        { fontSize: 12, color: '#b2bec3', alignSelf: 'flex-start' },

  medsBox:      { marginTop: 12, backgroundColor: '#f8f9fa', borderRadius: 10, padding: 12 },
  medsBoxTitle: { fontSize: 11, fontWeight: '700', color: '#636e72', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  medRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8 },
  medRowLeft:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  medRowIcon:   { fontSize: 18 },
  medRowTitle:  { fontSize: 13, fontWeight: '700', color: '#2d3436' },
  medRowTime:   { fontSize: 11, color: '#636e72', marginTop: 2 },
  medPctBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  medPctTxt:    { fontSize: 14, fontWeight: '800' },
  worstAlert:   { marginTop: 10, backgroundColor: '#fff3e6', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#ffd3b0' },
  worstAlertTxt:{ fontSize: 12, color: '#e67e22', fontWeight: '600', lineHeight: 18 },
});

// =============================================================================
// MAIN SCREEN
// =============================================================================
const MonitorHealthScreen = ({ route }: any) => {
  const params = route?.params || {};

  // Route params take priority. If missing (tab screen with no initialParams),
  // fall back to AsyncStorage so the caregiver always sees their data.
  const [caregiverId,        setCaregiverId]        = useState<number | undefined>(
    params.caregiverId ? Number(params.caregiverId) : undefined
  );
  const [elderId,            setElderId]            = useState<number | undefined>(
    params.elderId ? Number(params.elderId) : undefined
  );
  const [elderName,          setElderName]          = useState<string>(params.elderName || '');
  const [caregiverName,      setCaregiverName]      = useState<string>('');
  // For caregiver mode: first connected elder's ID used for Vitals/Risks tabs
  const [connectedElderId,   setConnectedElderId]   = useState<number | undefined>(undefined);
  const [connectedElderName, setConnectedElderName] = useState<string>('');

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (!raw) return;
      try {
        const user = JSON.parse(raw);
        if (user.role === 'caregiver' || user.role === 'doctor') {
          const cgId = params.caregiverId ? Number(params.caregiverId) : Number(user.id);
          if (!params.caregiverId) setCaregiverId(cgId);
          setCaregiverName(user.name || '');
          // Fetch connected elders so we can show Vitals/Risks for first elder
          fetch(getApiUrl(`/api/connections/${cgId}`))
            .then(r => r.json())
            .then((list: { id: number; name: string }[]) => {
              if (Array.isArray(list) && list.length > 0) {
                setConnectedElderId(list[0].id);
                setConnectedElderName(list[0].name || '');
              }
            })
            .catch(() => {});
        } else if (user.role === 'elderly') {
          if (!params.elderId) {
            setElderId(Number(user.id));
            setElderName(user.name || '');
          }
        }
      } catch {}
    });
  }, []);

  // Caregiver mode = has caregiverId but no specific elderId selected
  // Elder mode     = has elderId (either from params or storage)
  const isCaregiverMode = !!caregiverId && !elderId;

  const [activeTab, setActiveTab] = useState<Tab>('today');

  // Tabs differ by mode
  const TABS: { key: Tab; label: string }[] = isCaregiverMode
    ? [
        { key: 'today',     label: '📋 Today'     },
        { key: 'history',   label: '📜 History'   },
        { key: 'adherence', label: '📈 Adherence' },
        { key: 'vitals',    label: '📊 Vitals'    },
        { key: 'risks',     label: '⚠️ Risks'     },
      ]
    : [
        { key: 'today',     label: '📋 Today'     },
        { key: 'history',   label: '📜 Meds'      },
        { key: 'adherence', label: '📈 Adherence' },
        { key: 'vitals',    label: '📊 Vitals'    },
        { key: 'risks',     label: '⚠️ Risks'     },
      ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>Monitoring</Text>
          <Text style={styles.headerTitle}>
            {isCaregiverMode
              ? (connectedElderName || 'Health Overview')
              : (elderName || 'Health Monitor')}
          </Text>
        </View>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveTxt}>Live</Text>
        </View>
      </View>

      {/* Tab bar — scrollable to fit 5 tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBarScroll}
        contentContainerStyle={styles.tabBarContent}>
        {TABS.map(({ key, label }) => (
          <TouchableOpacity key={key} style={[styles.tab, activeTab === key && styles.tabActive]} onPress={() => setActiveTab(key)}>
            <Text style={[styles.tabTxt, activeTab === key && styles.tabTxtActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Each tab is its own self-contained component — no shared loading state */}
      <View style={styles.content}>
        {activeTab === 'today' && (
          <ScrollView>
            <TodayScheduleFeed
              caregiverId={isCaregiverMode ? caregiverId : undefined}
              elderId={!isCaregiverMode ? elderId : undefined}
            />
          </ScrollView>
        )}
        {activeTab === 'history' && (
          <ScrollView>
            <HistoryFeed
              caregiverId={isCaregiverMode ? caregiverId : undefined}
              elderId={!isCaregiverMode ? elderId : undefined}
            />
          </ScrollView>
        )}
        {activeTab === 'adherence' && (
          <AdherenceTab
            caregiverId={isCaregiverMode ? caregiverId : undefined}
            elderId={elderId}
            elderName={elderName}
          />
        )}
        {activeTab === 'vitals' && (
          (elderId || connectedElderId)
            ? <>
                {isCaregiverMode && connectedElderName ? (
                  <View style={styles.elderBanner}>
                    <Text style={styles.elderBannerTxt}>👤 Viewing: {connectedElderName}</Text>
                  </View>
                ) : null}
                <VitalsTab elderId={(elderId || connectedElderId)!} />
              </>
            : <View style={styles.loadingContainer}>
                <Text style={styles.emptyIcon}>📊</Text>
                <Text style={styles.emptyText}>No connected elders yet</Text>
              </View>
        )}
        {activeTab === 'risks' && (
          (elderId || connectedElderId)
            ? <>
                {isCaregiverMode && connectedElderName ? (
                  <View style={styles.elderBanner}>
                    <Text style={styles.elderBannerTxt}>👤 Viewing: {connectedElderName}</Text>
                  </View>
                ) : null}
                <RisksTab elderId={(elderId || connectedElderId)!} />
              </>
            : <View style={styles.loadingContainer}>
                <Text style={styles.emptyIcon}>⚠️</Text>
                <Text style={styles.emptyText}>No connected elders yet</Text>
              </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header:    { padding: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerSub:   { fontSize: 11, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e8fff4', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#27ae60' },
  liveTxt: { fontSize: 12, fontWeight: '700', color: '#27ae60' },
  tabBar:      { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBarScroll: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, maxHeight: 50 },
  tabBarContent:{ flexDirection: 'row', alignItems: 'center' },
  tab:         { paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent', minWidth: 80 },
  tabActive:   { borderBottomColor: colors.primary },
  tabTxt:      { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  tabTxtActive:{ color: colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content:    { flex: 1 },
  emptyIcon:  { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  emptyText:  { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 8, lineHeight: 22 },
  logCard:    { marginBottom: 12, marginHorizontal: 12, marginTop: 8 },
  logHeader:  { flexDirection: 'row', alignItems: 'center' },
  logIcon:    { fontSize: 28, marginRight: 12 },
  logInfo:    { flex: 1 },
  logType:    { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary },
  logDate:    { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logValueBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  logValueText:  { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  logNotes:   { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  noRisksCard:  { alignItems: 'center', paddingVertical: 50, margin: 12 },
  noRisksIcon:  { fontSize: 60, marginBottom: 16 },
  noRisksTitle: { fontSize: 18, fontWeight: 'bold', color: '#27ae60', marginBottom: 8 },
  noRisksText:  { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  riskLegendCard: { marginBottom: 12, backgroundColor: '#f0f8ff', marginHorizontal: 12 },
  riskLegendText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  riskCard:       { marginBottom: 12, padding: 14, borderRadius: 12, borderLeftWidth: 5, marginHorizontal: 12 },
  riskCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  riskSeverity:   { fontSize: 11, fontWeight: 'bold' },
  riskCardDate:   { fontSize: 11, color: colors.textSecondary },
  riskCardMessage:  { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  riskCardReadings: { fontSize: 11, color: colors.textSecondary, marginTop: 8, fontStyle: 'italic' },
  elderBanner:    { backgroundColor: '#f0f4ff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#dde4ff' },
  elderBannerTxt: { fontSize: 13, fontWeight: '700', color: '#2d3436' },
});

export default MonitorHealthScreen;