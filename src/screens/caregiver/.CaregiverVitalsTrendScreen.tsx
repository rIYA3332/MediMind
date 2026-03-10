// CaregiverVitalsTrendScreen.tsx — Caregiver-friendly version
// All technical jargon removed. Plain English throughout.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

const SCREEN_W = Dimensions.get('window').width;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reading    { date: string; value: string; numeric: number }
interface Regression {
  slope: number; intercept: number; r_squared: number; p_value: number;
  std_err: number; conf_95: number;
  trend: 'rising' | 'falling' | 'stable';
  trend_label: string; trend_color: string;
  change_per_week: number; predicted_today: number;
  summary: string; significance: string; significance_note: string;
}
interface Stats { min: number; max: number; avg: number; median: number; std: number; latest: number; count: number }
interface VitalAnalysis {
  log_type: string; label: string; unit: string;
  readings: Reading[]; trend_line: number[];
  regression: Regression; stats: Stats;
  data_window_days: number | null;
  data_window_label: string;
  same_day?: boolean;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VITAL_ICONS: Record<string, string> = {
  blood_pressure: '💉', blood_sugar: '🩸', heart_rate: '❤️',
  temperature: '🌡️', weight: '⚖️',
};
const VITAL_ORDER = ['blood_pressure', 'blood_sugar', 'heart_rate', 'temperature', 'weight'];
const NORMAL_RANGES: Record<string, string> = {
  blood_pressure: 'Normal: 90/60 – 120/80 mmHg',
  blood_sugar:    'Fasting: 70–100 mg/dL',
  heart_rate:     'Resting: 60–100 bpm',
  temperature:    'Normal: 97–99°F',
  weight:         'Track changes over time',
};

// Plain-English advice per vital per trend
const TREND_MEANING: Record<string, Record<string, string>> = {
  blood_pressure: {
    rising:  '⚠️ Blood pressure is going up. Consider consulting a doctor if it stays high.',
    falling: '✅ Blood pressure is coming down. Keep monitoring regularly.',
    stable:  '✅ Blood pressure is steady. No immediate concern.',
  },
  blood_sugar: {
    rising:  '⚠️ Blood sugar is rising. Check diet and medication schedule.',
    falling: '⚠️ Blood sugar is dropping. Ensure regular meals and snacks.',
    stable:  '✅ Blood sugar is stable. Keep up the current routine.',
  },
  heart_rate: {
    rising:  '⚠️ Heart rate is increasing. Watch for symptoms like chest pain or breathlessness.',
    falling: '✅ Heart rate is slowing. Normal if resting — consult a doctor if very low.',
    stable:  '✅ Heart rate is normal and steady.',
  },
  temperature: {
    rising:  '⚠️ Temperature is rising. Watch for signs of fever or infection.',
    falling: '✅ Temperature is dropping back toward normal.',
    stable:  '✅ Temperature is normal.',
  },
  weight: {
    rising:  'ℹ️ Weight is increasing. Monitor diet and fluid intake.',
    falling: 'ℹ️ Weight is decreasing. Ensure adequate nutrition.',
    stable:  '✅ Weight is stable.',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return raw; }
}

/** Returns { label, color } like "High 🔴" / "Low 🔵" / "Normal ✅" */
function getReadingStatus(log_type: string, numeric: number): { label: string; color: string } {
  const ranges: Record<string, { low: number; high: number }> = {
    blood_sugar:    { low: 70,   high: 140  },
    heart_rate:     { low: 60,   high: 100  },
    temperature:    { low: 97,   high: 99   },
    weight:         { low: 0,    high: 9999 }, // no fixed range
  };
  // blood_pressure uses systolic from "120/80" — numeric is already systolic
  if (log_type === 'blood_pressure') {
    if (numeric > 140)  return { label: 'High 🔴',   color: '#e17055' };
    if (numeric < 90)   return { label: 'Low 🔵',    color: '#0984e3' };
    return               { label: 'Normal ✅',        color: '#00b894' };
  }
  if (log_type === 'weight') return { label: '—', color: '#636e72' };
  const r = ranges[log_type];
  if (!r) return { label: '—', color: '#636e72' };
  if (numeric > r.high) return { label: 'High 🔴',  color: '#e17055' };
  if (numeric < r.low)  return { label: 'Low 🔵',   color: '#0984e3' };
  return                 { label: 'Normal ✅',       color: '#00b894' };
}

function trendEmoji(trend: string) {
  if (trend === 'rising')  return '↑';
  if (trend === 'falling') return '↓';
  return '→';
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

const Sparkline: React.FC<{ values: number[]; trendLine: number[]; color: string }> = ({
  values, trendLine, color,
}) => {
  if (values.length < 2) return null;
  const h    = 48;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rng  = maxV - minV || 1;
  const barW = Math.max(3, Math.floor(((SCREEN_W - 80) / values.length) - 2));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: h, gap: 2, marginVertical: 8 }}>
      {values.map((v, i) => {
        const barH       = Math.max(4, Math.round(((v - minV) / rng) * (h - 8)) + 4);
        const aboveTrend = v >= (trendLine[i] ?? v);
        return (
          <View key={i} style={{
            width: barW, height: barH, borderRadius: 2,
            backgroundColor: aboveTrend ? color : color + '55',
          }} />
        );
      })}
    </View>
  );
};

// ─── Vital card ───────────────────────────────────────────────────────────────

const VitalTrendCard: React.FC<{ vital: VitalAnalysis; requestedDays: number }> = ({
  vital, requestedDays,
}) => {
  const [open, setOpen] = useState(false);
  const { regression: reg, stats, readings, trend_line, label, unit,
          log_type, data_window_days, data_window_label, same_day } = vital;

  if (vital.error) {
    return (
      <View style={[card.wrap, { borderLeftColor: '#dfe6e9' }]}>
        <View style={card.header}>
          <Text style={card.icon}>{VITAL_ICONS[log_type] || '📊'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={card.title}>{label}</Text>
            <Text style={[card.summary, { color: '#e17055' }]}>Not enough data yet to show a trend.</Text>
          </View>
        </View>
      </View>
    );
  }

  const sparkVals  = readings.slice(-14).map(r => r.numeric);
  const sparkTrend = trend_line.slice(-14);
  const n          = readings.length;
  const meaning    = TREND_MEANING[log_type]?.[reg.trend] || reg.summary;

  const changeAbs = Math.abs(reg.change_per_week);
  const changeLbl = same_day
    ? `Varied by ${changeAbs} ${unit} across today's readings`
    : changeAbs > 0 && reg.trend !== 'stable'
      ? `${reg.trend === 'rising' ? 'Increasing' : 'Decreasing'} by about ${changeAbs} ${unit} per week`
      : 'No significant change week over week';

  return (
    <View style={[card.wrap, { borderLeftColor: reg.trend_color }]}>

      {/* Not enough history notice */}
      {data_window_days !== null && data_window_days < requestedDays && (
        <View style={card.windowBanner}>
          <Text style={card.windowBannerTxt}>
            📅 Showing {data_window_label} — not enough older data yet
          </Text>
        </View>
      )}

      {/* Card header */}
      <TouchableOpacity style={card.header} onPress={() => setOpen(o => !o)} activeOpacity={0.85}>
        <Text style={card.icon}>{VITAL_ICONS[log_type] || '📊'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={card.title}>{label}</Text>
          <Text style={card.summary}>{meaning}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <View style={[card.badge, { backgroundColor: reg.trend_color + '22', borderColor: reg.trend_color }]}>
            <Text style={[card.badgeTxt, { color: reg.trend_color }]}>
              {trendEmoji(reg.trend)} {capitalize(reg.trend)}
            </Text>
          </View>
          <Text style={card.expandHint}>{open ? '▲ Less' : '▼ Details'}</Text>
        </View>
      </TouchableOpacity>

      {/* Chart */}
      <Sparkline values={sparkVals} trendLine={sparkTrend} color={reg.trend_color} />

      {/* Stats strip */}
      <View style={card.statStrip}>
        {[
          { l: 'Latest',  v: `${stats.latest}`,  u: unit, c: reg.trend_color },
          { l: 'Average', v: `${stats.avg}`,      u: unit, c: undefined },
          { l: 'Lowest',  v: `${stats.min}`,      u: unit, c: '#00b894' },
          { l: 'Highest', v: `${stats.max}`,      u: unit, c: '#e17055' },
        ].map((s, i) => (
          <React.Fragment key={s.l}>
            {i > 0 && <View style={card.stripDivider} />}
            <View style={card.stripCell}>
              <Text style={[card.stripVal, s.c ? { color: s.c } : {}]}>{s.v}</Text>
              <Text style={card.stripUnit}>{s.u}</Text>
              <Text style={card.stripLbl}>{s.l}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      <Text style={card.unitNote}>{NORMAL_RANGES[log_type]}</Text>

      {/* Expanded detail */}
      {open && (
        <View style={card.expanded}>

          <Text style={card.secHead}>📋 What This Means for {label}</Text>
          <View style={card.infoBox}>
            <Text style={card.infoTxt}>{meaning}</Text>
            <Text style={[card.infoTxt, { marginTop: 8, color: colors.textSecondary }]}>{changeLbl}</Text>
            <Text style={[card.infoTxt, { marginTop: 8, color: colors.textSecondary }]}>
              Based on {n} reading{n !== 1 ? 's' : ''} · Next expected: ~{reg.predicted_today} {unit}
            </Text>
          </View>

          <Text style={card.secHead}>📊 At a Glance</Text>
          <View style={card.friendlyGrid}>
            {[
              { lbl: 'Most Recent',  val: `${stats.latest} ${unit}`, color: reg.trend_color },
              { lbl: 'Average',      val: `${stats.avg} ${unit}`,    color: undefined },
              { lbl: 'Lowest',       val: `${stats.min} ${unit}`,    color: '#00b894' },
              { lbl: 'Highest',      val: `${stats.max} ${unit}`,    color: '#e17055' },
            ].map(s => (
              <View key={s.lbl} style={card.friendlyBox}>
                <Text style={[card.friendlyVal, s.color ? { color: s.color } : {}]}>{s.val}</Text>
                <Text style={card.friendlyLbl}>{s.lbl}</Text>
              </View>
            ))}
          </View>

          <Text style={card.secHead}>🕐 Reading History ({n} readings)</Text>
          <View style={card.tblHead}>
            <Text style={[card.tblCell, card.tblHd, { flex: 1.8 }]}>When</Text>
            <Text style={[card.tblCell, card.tblHd]}>Reading</Text>
            <Text style={[card.tblCell, card.tblHd]}>Status</Text>
          </View>
          {[...readings].reverse().map((r, i) => {
            const status = getReadingStatus(log_type, r.numeric);
            return (
              <View key={i} style={[card.tblRow, i % 2 === 0 && card.tblRowAlt]}>
                <Text style={[card.tblCell, { flex: 1.8, fontSize: 11 }]}>{formatDate(r.date)}</Text>
                <Text style={[card.tblCell, { fontWeight: '600' }]}>{r.value} {unit}</Text>
                <Text style={[card.tblCell, { color: status.color, fontWeight: '600', fontSize: 11 }]}>{status.label}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

// ─── Main screen ──────────────────────────────────────────────────────────────

interface Props {
  route:      { params: { elderId: number; elderName: string } };
  navigation: any;
}

const CaregiverVitalsTrendScreen: React.FC<Props> = ({ route, navigation }) => {
  const { elderId, elderName } = route.params;

  const [vitals,       setVitals]       = useState<VitalAnalysis[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [error,        setError]        = useState('');
  const [days,         setDays]         = useState<7 | 14 | 30>(30);
  const [actualWindow, setActualWindow] = useState<string | null>(null);

  const PERIOD_LABELS: Record<number, string> = {
    7: 'Last 7 Days', 14: 'Last 14 Days', 30: 'Last 30 Days',
  };

  const fetchTrends = useCallback(async () => {
    setLoading(true);
    setError('');
    setActualWindow(null);
    try {
      const res = await fetch(getApiUrl(`/api/health-trends/report/${elderId}?days=${days}`));
      const raw = await res.text();
      let data: any;
      try { data = JSON.parse(raw); }
      catch { throw new Error('Server error. Please try again.'); }
      if (!res.ok) throw new Error('Could not load health trends. Please try again.');

      const arr = Array.isArray(data) ? data : [];
      const sorted = arr
        .filter((v: VitalAnalysis) => !v.error || v.error)
        .sort((a: VitalAnalysis, b: VitalAnalysis) =>
          VITAL_ORDER.indexOf(a.log_type) - VITAL_ORDER.indexOf(b.log_type)
        );
      setVitals(sorted);

      const windows = sorted
        .map((v: VitalAnalysis) => v.data_window_days)
        .filter((w: number | null) => w !== null && w !== undefined) as number[];
      if (windows.length) {
        const minW = Math.min(...windows);
        if (minW < days) {
          setActualWindow(`Not enough data for ${days} days — showing ${minW} days instead`);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Network error. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [elderId, days]);

  useEffect(() => { fetchTrends(); }, [fetchTrends]);
  const onRefresh = () => { setRefreshing(true); fetchTrends(); };

  const goodVitals = vitals.filter(v => !v.error && v.readings?.length >= 2);
  const risingList = goodVitals.filter(v => v.regression?.trend === 'rising');

  return (
    <SafeAreaView style={scr.container}>

      {/* Header */}
      <View style={scr.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={{ padding: 4, marginRight: 8 }}>
          <Text style={{ fontSize: 22, color: colors.primary }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={scr.headerTitle}>Health Trends</Text>
          <Text style={scr.headerSub}>{elderName}</Text>
        </View>
        <View style={scr.periodRow}>
          {([7, 14, 30] as const).map(d => (
            <TouchableOpacity key={d}
              style={[scr.periodBtn, days === d && scr.periodBtnOn]}
              onPress={() => { if (d !== days) setDays(d); }}>
              <Text style={[scr.periodTxt, days === d && scr.periodTxtOn]}>{d}d</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Window notice */}
      {!loading && actualWindow && (
        <View style={scr.windowNotice}>
          <Text style={scr.windowNoticeTxt}>ℹ️ {actualWindow}</Text>
        </View>
      )}

      {/* Rising alert */}
      {!loading && risingList.length > 0 && (
        <View style={scr.alertBanner}>
          <Text style={scr.alertTxt}>
            ⚠️ {risingList.map(v => v.label).join(' and ')} {risingList.length > 1 ? 'are' : 'is'} going up — please review with a doctor.
          </Text>
        </View>
      )}

      {/* Body */}
      {loading ? (
        <View style={scr.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={scr.loadTxt}>Loading health trends…</Text>
          <Text style={scr.loadSub}>Analysing {elderName}'s readings</Text>
        </View>
      ) : error ? (
        <View style={scr.center}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>⚠️</Text>
          <Text style={scr.errTxt}>{error}</Text>
          <TouchableOpacity style={scr.retryBtn} onPress={fetchTrends}>
            <Text style={scr.retryTxt}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : vitals.length === 0 ? (
        <View style={scr.center}>
          <Text style={{ fontSize: 56, marginBottom: 16 }}>📊</Text>
          <Text style={scr.emptyTitle}>No readings yet</Text>
          <Text style={scr.emptyTxt}>
            {elderName} needs at least 2 readings of the same vital{'\n'}
            (e.g. blood sugar logged twice) before trends can be shown.
          </Text>
          <TouchableOpacity style={[scr.retryBtn, { marginTop: 20 }]} onPress={fetchTrends}>
            <Text style={scr.retryTxt}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={scr.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          {/* Overview card */}
          <View style={scr.summaryCard}>
            <Text style={scr.summaryTitle}>📈 Overview · {PERIOD_LABELS[days]}</Text>
            <Text style={scr.summaryHint}>Tap any card below for full details</Text>
            {goodVitals.map(v => (
              <View key={v.log_type} style={scr.summaryRow}>
                <Text style={scr.summaryIcon}>{VITAL_ICONS[v.log_type] || '📊'}</Text>
                <Text style={scr.summaryLabel}>{v.label}</Text>
                <View style={[scr.summaryBadge, {
                  backgroundColor: v.regression.trend_color + '22',
                  borderColor:     v.regression.trend_color,
                }]}>
                  <Text style={[scr.summaryBadgeTxt, { color: v.regression.trend_color }]}>
                    {trendEmoji(v.regression.trend)} {capitalize(v.regression.trend)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {vitals.map(vital => (
            <VitalTrendCard key={vital.log_type} vital={vital} requestedDays={days} />
          ))}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const card = StyleSheet.create({
  wrap:          { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginBottom: 14, borderLeftWidth: 5, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  header:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  icon:          { fontSize: 30, marginTop: 2 },
  title:         { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  summary:       { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  expandHint:    { fontSize: 11, color: colors.textSecondary },
  badge:         { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt:      { fontSize: 11, fontWeight: '700' },
  statStrip:     { flexDirection: 'row', backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, marginBottom: 4 },
  stripCell:     { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  stripVal:      { fontSize: 13, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  stripUnit:     { fontSize: 9, color: colors.textSecondary, textAlign: 'center' },
  stripLbl:      { fontSize: 9, color: colors.textSecondary, marginTop: 1, textTransform: 'uppercase', textAlign: 'center' },
  stripDivider:  { width: 1, backgroundColor: colors.border },
  unitNote:      { fontSize: 10, color: colors.textSecondary, marginBottom: 6 },
  expanded:      { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  secHead:       { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 8, marginTop: 4 },
  infoBox:       { backgroundColor: '#f0f7ff', borderRadius: 10, padding: 12, marginBottom: 14 },
  infoTxt:       { fontSize: 13, color: colors.textPrimary, lineHeight: 20 },
  friendlyGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  friendlyBox:   { backgroundColor: colors.background, borderRadius: 10, padding: 10, alignItems: 'center', flex: 1, minWidth: '40%' },
  friendlyVal:   { fontSize: 14, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  friendlyLbl:   { fontSize: 10, color: colors.textSecondary, marginTop: 3, textAlign: 'center' },
  tblHead:       { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1.5, borderBottomColor: colors.border },
  tblHd:         { fontWeight: '700', color: colors.textSecondary, fontSize: 10, textTransform: 'uppercase' },
  tblRow:        { flexDirection: 'row', paddingVertical: 7 },
  tblRowAlt:     { backgroundColor: '#f9f9f9' },
  tblCell:       { flex: 1, fontSize: 12, color: colors.textPrimary },
  windowBanner:  { backgroundColor: '#fff8e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#f9a825' },
  windowBannerTxt: { fontSize: 11, color: '#e65100', fontWeight: '600' },
});

const scr = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.background },
  header:          { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:     { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  headerSub:       { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  periodRow:       { flexDirection: 'row', gap: 5 },
  periodBtn:       { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  periodBtnOn:     { backgroundColor: colors.primary, borderColor: colors.primary },
  periodTxt:       { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  periodTxtOn:     { color: '#fff' },
  windowNotice:    { backgroundColor: '#fff3e0', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ffe0b2' },
  windowNoticeTxt: { fontSize: 12, color: '#e65100', fontWeight: '600' },
  alertBanner:     { backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#ffc107', padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 10 },
  alertTxt:        { color: '#856404', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  content:         { padding: 16 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  loadTxt:         { marginTop: 12, fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  loadSub:         { marginTop: 5, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  errTxt:          { color: '#e17055', fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  retryBtn:        { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  retryTxt:        { color: '#fff', fontWeight: '700' },
  emptyTitle:      { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  emptyTxt:        { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  summaryCard:     { backgroundColor: colors.white, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  summaryTitle:    { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  summaryHint:     { fontSize: 11, color: colors.textSecondary, marginBottom: 12, fontStyle: 'italic' },
  summaryRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  summaryIcon:     { fontSize: 20, width: 28 },
  summaryLabel:    { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  summaryBadge:    { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  summaryBadgeTxt: { fontSize: 11, fontWeight: '700' },
});

export default CaregiverVitalsTrendScreen;