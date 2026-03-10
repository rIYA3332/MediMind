import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

const SCREEN_W = Dimensions.get('window').width;

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface HealthLog {
  id: number; log_type: string; value: string;
  unit: string; notes: string; logged_at: string;
}
interface HealthRisk {
  id: number; risk_type: string; log_type: string;
  severity: string; message: string; readings_count: number; detected_at: string;
}
interface LatestVital {
  log_type: string; value: string; unit: string; logged_at: string;
}
interface Reading { date: string; value: string; numeric: number }
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
  blood_pressure: '💉', blood_sugar: '🩸', heart_rate: '❤️', temperature: '🌡️', weight: '⚖️',
};
const VITAL_ORDER = ['blood_pressure', 'blood_sugar', 'heart_rate', 'temperature', 'weight'];
const NORMAL_RANGES: Record<string, string> = {
  blood_pressure: 'Normal: 90/60 – 120/80 mmHg',
  blood_sugar:    'Fasting: 70–100 mg/dL',
  heart_rate:     'Resting: 60–100 bpm',
  temperature:    'Normal: 97–99°F',
  weight:         'Track changes over time',
};
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
const PERIOD_LABELS: Record<number, string> = {
  7: 'Last 7 Days', 14: 'Last 14 Days', 30: 'Last 30 Days',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** FIX #4 — correctly labels Today / Yesterday before falling back to locale string */
function formatDateShort(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;

    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDay  = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());
    const diffDays = Math.round((today.getTime() - dDay.getTime()) / 86_400_000);

    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (diffDays === 0) return `Today, ${time}`;
    if (diffDays === 1) return `Yesterday, ${time}`;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return raw; }
}

function getReadingStatus(log_type: string, numeric: number): { label: string; color: string } {
  if (log_type === 'blood_pressure') {
    if (numeric > 140) return { label: 'High 🔴', color: '#e17055' };
    if (numeric < 90)  return { label: 'Low 🔵',  color: '#0984e3' };
    return              { label: 'Normal ✅',      color: '#00b894' };
  }
  if (log_type === 'weight') return { label: '—', color: '#636e72' };
  const ranges: Record<string, { low: number; high: number }> = {
    blood_sugar: { low: 70, high: 140 }, heart_rate: { low: 60, high: 100 }, temperature: { low: 97, high: 99 },
  };
  const r = ranges[log_type];
  if (!r) return { label: '—', color: '#636e72' };
  if (numeric > r.high) return { label: 'High 🔴', color: '#e17055' };
  if (numeric < r.low)  return { label: 'Low 🔵',  color: '#0984e3' };
  return                 { label: 'Normal ✅',      color: '#00b894' };
}

function trendEmoji(t: string)  { return t === 'rising' ? '↑' : t === 'falling' ? '↓' : '→'; }
function capitalize(s: string)  { return s.charAt(0).toUpperCase() + s.slice(1); }

/** FIX #1 — filter readings to only those within the requested day window */
function filterReadingsByDays(readings: Reading[], days: number): Reading[] {
  const cutoff = Date.now() - days * 86_400_000;
  const filtered = readings.filter(r => new Date(r.date).getTime() >= cutoff);
  // always show at least 1 reading so the card doesn't appear broken
  return filtered.length > 0 ? filtered : readings.slice(-1);
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ values: number[]; trendLine: number[]; color: string }> = ({ values, trendLine, color }) => {
  if (values.length < 2) return null;
  const h = 48, minV = Math.min(...values), maxV = Math.max(...values), rng = maxV - minV || 1;
  const barW = Math.max(3, Math.floor(((SCREEN_W - 80) / values.length) - 2));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: h, gap: 2, marginVertical: 8 }}>
      {values.map((v, i) => (
        <View key={i} style={{
          width: barW, borderRadius: 2,
          height: Math.max(4, Math.round(((v - minV) / rng) * (h - 8)) + 4),
          backgroundColor: v >= (trendLine[i] ?? v) ? color : color + '55',
        }} />
      ))}
    </View>
  );
};

// ─── VitalTrendCard ───────────────────────────────────────────────────────────
const VitalTrendCard: React.FC<{ vital: VitalAnalysis; requestedDays: number }> = ({ vital, requestedDays }) => {
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

  // FIX #1 — only show readings within the selected window
  const windowedReadings = filterReadingsByDays(readings, requestedDays);
  const sparkVals        = windowedReadings.map(r => r.numeric);
  // align trend_line to the windowed slice
  const startIdx         = readings.length - windowedReadings.length;
  const sparkTrend       = trend_line.slice(startIdx);

  const n         = windowedReadings.length;
  const meaning   = TREND_MEANING[log_type]?.[reg.trend] || reg.summary;
  const changeAbs = Math.abs(reg.change_per_week);
  const changeLbl = same_day
    ? `Varied by ${changeAbs} ${unit} across today's readings`
    : changeAbs > 0 && reg.trend !== 'stable'
      ? `${reg.trend === 'rising' ? 'Increasing' : 'Decreasing'} by about ${changeAbs} ${unit} per week`
      : 'No significant change week over week';

  // recompute windowed stats
  const nums    = windowedReadings.map(r => r.numeric);
  const wLatest = nums[nums.length - 1] ?? stats.latest;
  const wMin    = Math.min(...nums);
  const wMax    = Math.max(...nums);
  const wAvg    = nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : stats.avg;

  return (
    <View style={[card.wrap, { borderLeftColor: reg.trend_color }]}>
      {data_window_days !== null && data_window_days < requestedDays && (
        <View style={card.windowBanner}>
          <Text style={card.windowBannerTxt}>📅 Showing {data_window_label} — not enough older data yet</Text>
        </View>
      )}

      <TouchableOpacity style={card.header} onPress={() => setOpen(o => !o)} activeOpacity={0.85}>
        <Text style={card.icon}>{VITAL_ICONS[log_type] || '📊'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={card.title}>{label}</Text>
          <Text style={card.summary}>{meaning}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <View style={[card.badge, { backgroundColor: reg.trend_color + '22', borderColor: reg.trend_color }]}>
            <Text style={[card.badgeTxt, { color: reg.trend_color }]}>{trendEmoji(reg.trend)} {capitalize(reg.trend)}</Text>
          </View>
          <Text style={card.expandHint}>{open ? '▲ Less' : '▼ Details'}</Text>
        </View>
      </TouchableOpacity>

      <Sparkline values={sparkVals} trendLine={sparkTrend} color={reg.trend_color} />

      {/* Stats strip — uses windowed values */}
      <View style={card.statStrip}>
        {[
          { l: 'Latest',  v: `${wLatest}`, u: unit, c: reg.trend_color },
          { l: 'Average', v: `${wAvg}`,    u: unit, c: undefined },
          { l: 'Lowest',  v: `${wMin}`,    u: unit, c: '#00b894' },
          { l: 'Highest', v: `${wMax}`,    u: unit, c: '#e17055' },
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

      {open && (
        <View style={card.expanded}>
          <Text style={card.secHead}>📋 What This Means for {label}</Text>
          <View style={card.infoBox}>
            <Text style={card.infoTxt}>{meaning}</Text>
            <Text style={[card.infoTxt, { marginTop: 8, color: colors.textSecondary }]}>{changeLbl}</Text>
            <Text style={[card.infoTxt, { marginTop: 8, color: colors.textSecondary }]}>
              Based on {n} reading{n !== 1 ? 's' : ''} in this period · Next expected: ~{reg.predicted_today} {unit}
            </Text>
          </View>

          <Text style={card.secHead}>📊 At a Glance</Text>
          <View style={card.friendlyGrid}>
            {[
              { lbl: 'Most Recent', val: `${wLatest} ${unit}`, color: reg.trend_color },
              { lbl: 'Average',     val: `${wAvg} ${unit}`,    color: undefined },
              { lbl: 'Lowest',      val: `${wMin} ${unit}`,    color: '#00b894' },
              { lbl: 'Highest',     val: `${wMax} ${unit}`,    color: '#e17055' },
            ].map(s => (
              <View key={s.lbl} style={card.friendlyBox}>
                <Text style={[card.friendlyVal, s.color ? { color: s.color } : {}]}>{s.val}</Text>
                <Text style={card.friendlyLbl}>{s.lbl}</Text>
              </View>
            ))}
          </View>

          {/* FIX #3 — Reading History table with proper column spacing */}
          <Text style={card.secHead}>🕐 Reading History ({n} readings)</Text>
          <View style={card.tblHead}>
            <Text style={[card.tblWhen, card.tblHd]}>When</Text>
            <Text style={[card.tblReading, card.tblHd]}>Reading</Text>
            <Text style={[card.tblStatus, card.tblHd]}>Status</Text>
          </View>
          {[...windowedReadings].reverse().map((r, i) => {
            const status = getReadingStatus(log_type, r.numeric);
            return (
              <View key={i} style={[card.tblRow, i % 2 === 0 && card.tblRowAlt]}>
                <Text style={[card.tblWhen,    { fontSize: 11, color: colors.textPrimary }]}>{formatDateShort(r.date)}</Text>
                <Text style={[card.tblReading, { fontWeight: '600', color: colors.textPrimary }]}>{r.value} {unit}</Text>
                <Text style={[card.tblStatus,  { color: status.color, fontWeight: '600', fontSize: 11 }]}>{status.label}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

// ─── Card styles ──────────────────────────────────────────────────────────────
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
  // FIX #3 — fixed-width columns so Reading and Status never overlap
  tblHead:       { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1.5, borderBottomColor: colors.border },
  tblHd:         { fontWeight: '700', color: colors.textSecondary, fontSize: 10, textTransform: 'uppercase' },
  tblRow:        { flexDirection: 'row', paddingVertical: 8, alignItems: 'center' },
  tblRowAlt:     { backgroundColor: '#f9f9f9' },
  tblWhen:       { flex: 2, fontSize: 12, paddingRight: 4 },
  tblReading:    { flex: 1.4, fontSize: 12, paddingHorizontal: 4 },
  tblStatus:     { flex: 1.2, fontSize: 12, paddingLeft: 4 },
  windowBanner:  { backgroundColor: '#fff8e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#f9a825' },
  windowBannerTxt: { fontSize: 11, color: '#e65100', fontWeight: '600' },
});

// ─── Original helpers ─────────────────────────────────────────────────────────
const vitalConfig: Record<string, { icon: string; label: string; unit: string; normalRange: string; trendLabel: string }> = {
  blood_pressure: { icon: '🩺', label: 'Blood Pressure', unit: 'mmHg', normalRange: '90-120 / 60-80', trendLabel: '7-Day BP Trend' },
  blood_sugar:    { icon: '🩸', label: 'Blood Sugar',    unit: 'mg/dL', normalRange: '70-140',         trendLabel: '7-Day Sugar Trend' },
  weight:         { icon: '⚖️', label: 'Weight',         unit: 'kg',    normalRange: 'Varies',          trendLabel: '7-Day Weight Trend' },
  temperature:    { icon: '🌡️', label: 'Temperature',    unit: '°F',    normalRange: '97-99',           trendLabel: '7-Day Temp Trend' },
  heart_rate:     { icon: '❤️', label: 'Heart Rate',     unit: 'bpm',   normalRange: '60-100',          trendLabel: '7-Day HR Trend' },
};

const getValueStatus = (type: string, value: string): string => {
  if (type === 'blood_pressure') {
    const parts = value.split('/');
    if (parts.length !== 2) return 'Normal Range';
    const sys = parseInt(parts[0]), dia = parseInt(parts[1]);
    if (sys > 180 || dia > 120) return 'Critical';
    if (sys > 140 || dia > 90)  return 'Elevated';
    if (sys < 90  || dia < 60)  return 'Low';
    return 'Normal Range';
  }
  if (type === 'blood_sugar')  { const v = parseFloat(value); if (v < 54) return 'Critical'; if (v < 70) return 'Low'; if (v > 180) return 'Elevated'; return 'Normal Range'; }
  if (type === 'heart_rate')   { const v = parseFloat(value); if (v > 130 || v < 50) return 'Critical'; if (v > 100) return 'Elevated'; if (v < 60) return 'Low'; return 'Normal Range'; }
  if (type === 'temperature')  { const v = parseFloat(value); if (v >= 103) return 'Critical'; if (v >= 100.4) return 'Elevated'; if (v < 96) return 'Low'; return 'Normal Range'; }
  if (type === 'weight') return 'Stable';
  return 'Normal Range';
};

const statusStyle = (status: string) => {
  switch (status) {
    case 'Normal Range': return { bg: '#d4faf0', text: '#00b894' };
    case 'Stable':       return { bg: '#d4faf0', text: '#00b894' };
    case 'Elevated':     return { bg: '#fff3cd', text: '#e67e22' };
    case 'Low':          return { bg: '#cce5ff', text: '#0056b3' };
    case 'Critical':     return { bg: '#ffd6d6', text: '#ff4757' };
    default:             return { bg: '#f0f0f0', text: '#95a5a6' };
  }
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const HealthStatusScreen = ({ route, navigation }: any) => {
  const { elderId, elderName } = route.params || {};
  const [latestVitals, setLatestVitals] = useState<LatestVital[]>([]);
  const [recentLogs,   setRecentLogs]   = useState<HealthLog[]>([]);
  const [risks,        setRisks]        = useState<HealthRisk[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const [vitals,       setVitals]       = useState<VitalAnalysis[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendDays,    setTrendDays]    = useState<7 | 14 | 30>(30);
  const [actualWindow, setActualWindow] = useState<string | null>(null);

  useEffect(() => { if (elderId) fetchHealthData(); }, [elderId]);

  const fetchHealthData = async () => {
    setLoading(true);
    try {
      const [latestRes, logsRes, risksRes] = await Promise.all([
        fetch(getApiUrl(`/api/health-logs/latest/${elderId}`)),
        fetch(getApiUrl(`/api/health-logs/${elderId}`)),
        fetch(getApiUrl(`/api/health-risks/${elderId}`)),
      ]);
      const [latestData, logsData, risksData] = await Promise.all([
        latestRes.json(), logsRes.json(), risksRes.json(),
      ]);
      setLatestVitals(Array.isArray(latestData) ? latestData : []);
      setRecentLogs(Array.isArray(logsData) ? logsData.slice(0, 20) : []);
      setRisks(Array.isArray(risksData) ? risksData : []);
    } catch (e) { console.log('Fetch error', e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const fetchTrends = useCallback(async () => {
    setTrendLoading(true);
    setActualWindow(null);
    try {
      const res  = await fetch(getApiUrl(`/api/health-trends/report/${elderId}?days=${trendDays}`));
      const data = await res.json();
      const arr  = Array.isArray(data) ? data : [];
      const sorted = arr.sort((a: VitalAnalysis, b: VitalAnalysis) =>
        VITAL_ORDER.indexOf(a.log_type) - VITAL_ORDER.indexOf(b.log_type)
      );
      setVitals(sorted);
      const windows = sorted
        .map((v: VitalAnalysis) => v.data_window_days)
        .filter((w: number | null) => w !== null && w !== undefined) as number[];
      if (windows.length) {
        const minW = Math.min(...windows);
        if (minW < trendDays) setActualWindow(`Not enough data for ${trendDays} days — showing ${minW} days instead`);
      }
    } catch (e) { console.log('Trend error', e); }
    finally { setTrendLoading(false); }
  }, [elderId, trendDays]);

  useEffect(() => { if (elderId) fetchTrends(); }, [fetchTrends]);

  const onRefresh = () => { setRefreshing(true); fetchHealthData(); fetchTrends(); };

  const formatDate = (dateString: string) => {
    // reuse the same Today/Yesterday logic
    return formatDateShort(dateString);
  };

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return { bg: '#fff0f0', border: '#ff4757', text: '#ff4757', label: '🚨 CRITICAL' };
      case 'danger':   return { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ DANGER' };
      default:         return { bg: '#fffdf0', border: '#fdcb6e', text: '#856404', label: '⚠️ WARNING' };
    }
  };

  const vitalsMap: Record<string, LatestVital> = {};
  latestVitals.forEach(v => { vitalsMap[v.log_type] = v; });

  const goodVitals = vitals.filter(v => !v.error && v.readings?.length >= 2);
  const risingList = goodVitals.filter(v => v.regression?.trend === 'rising');

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading health data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Caregiver - Elder Health Status</Text>
          <Text style={styles.headerSubtitle}>{elderName}</Text>
        </View>
        <TouchableOpacity style={styles.menuBtn}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

        {/* Active Risks Banner */}
        {risks.length > 0 && (
          <View style={styles.risksBanner}>
            <Text style={styles.risksBannerTitle}>⚠️ {risks.length} Active Health Risk{risks.length > 1 ? 's' : ''}</Text>
            {risks.slice(0, 2).map((risk) => {
              const s = getSeverityStyle(risk.severity);
              return (
                <View key={risk.id} style={[styles.riskItem, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                  <Text style={[styles.riskSeverityLabel, { color: s.text }]}>{s.label}</Text>
                  <Text style={styles.riskMessage}>{risk.message}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Vital Signs header row with period toggle */}
        <View style={styles.trendHeaderRow}>
          <Text style={styles.sectionLabel}>Vital Signs</Text>
          <View style={styles.periodRow}>
            {([7, 14, 30] as const).map(d => (
              <TouchableOpacity key={d}
                style={[styles.periodBtn, trendDays === d && styles.periodBtnOn]}
                onPress={() => { if (d !== trendDays) setTrendDays(d); }}>
                <Text style={[styles.periodTxt, trendDays === d && styles.periodTxtOn]}>{d}d</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* FIX #2 — Rising alert with bottom margin so overview has breathing room */}
        {!trendLoading && risingList.length > 0 && (
          <View style={styles.alertBanner}>
            <Text style={styles.alertTxt}>
              ⚠️ {risingList.map(v => v.label).join(' and ')} {risingList.length > 1 ? 'are' : 'is'} going up — please review with a doctor.
            </Text>
          </View>
        )}

        {/* Window notice */}
        {!trendLoading && actualWindow && (
          <View style={styles.windowNotice}>
            <Text style={styles.windowNoticeTxt}>ℹ️ {actualWindow}</Text>
          </View>
        )}

        {trendLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20, justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Loading trends…</Text>
          </View>
        ) : vitals.length === 0 ? (
          <Card style={styles.emptyCard}><Text style={styles.emptyText}>No vital signs recorded yet</Text></Card>
        ) : (
          <View style={{ paddingHorizontal: 15 }}>
            {/* FIX #2 — Overview card with explicit top + bottom margin */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>📈 Overview · {PERIOD_LABELS[trendDays]}</Text>
              <Text style={styles.summaryHint}>Tap any card below for full details</Text>
              {goodVitals.map(v => (
                <View key={v.log_type} style={styles.summaryRow}>
                  <Text style={styles.summaryIcon}>{VITAL_ICONS[v.log_type] || '📊'}</Text>
                  <Text style={styles.summaryLabel}>{v.label}</Text>
                  <View style={[styles.summaryBadge, {
                    backgroundColor: v.regression.trend_color + '22',
                    borderColor:     v.regression.trend_color,
                  }]}>
                    <Text style={[styles.summaryBadgeTxt, { color: v.regression.trend_color }]}>
                      {trendEmoji(v.regression.trend)} {capitalize(v.regression.trend)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {vitals.map(vital => (
              <VitalTrendCard key={vital.log_type} vital={vital} requestedDays={trendDays} />
            ))}
          </View>
        )}

        {/* Recent Readings */}
        {recentLogs.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Recent Readings</Text>
            <Card>
              {recentLogs.slice(0, 8).map((log) => {
                const status = getValueStatus(log.log_type, log.value);
                const ss  = statusStyle(status);
                const cfg = vitalConfig[log.log_type];
                return (
                  <View key={log.id} style={styles.logRow}>
                    <Text style={styles.logIcon}>{cfg?.icon || '📊'}</Text>
                    <View style={styles.logInfo}>
                      <Text style={styles.logType}>{cfg?.label || log.log_type}</Text>
                      <Text style={styles.logDate}>{formatDate(log.logged_at)}</Text>
                    </View>
                    <View style={[styles.logBadge, { backgroundColor: ss.bg }]}>
                      <Text style={[styles.logBadgeText, { color: ss.text }]}>{log.value} {log.unit}</Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: colors.background },
  header:            { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:           { padding: 4, marginRight: 8 },
  backIcon:          { fontSize: 20, color: colors.primary },
  headerText:        { flex: 1 },
  headerTitle:       { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary },
  headerSubtitle:    { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  menuBtn:           { padding: 4 },
  menuIcon:          { fontSize: 20, color: colors.textSecondary },
  loadingContainer:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:       { marginTop: 12, color: colors.textSecondary },
  content:           { flex: 1 },
  sectionLabel:      { fontSize: 14, fontWeight: '700', color: colors.textPrimary, paddingHorizontal: 15, paddingTop: 16, paddingBottom: 8 },
  risksBanner:       { margin: 15, marginBottom: 0 },
  risksBannerTitle:  { fontSize: 14, fontWeight: 'bold', color: '#e17055', marginBottom: 8 },
  riskItem:          { borderLeftWidth: 4, padding: 10, borderRadius: 8, marginBottom: 8 },
  riskSeverityLabel: { fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  riskMessage:       { fontSize: 12, color: colors.textPrimary, lineHeight: 17 },
  emptyCard:         { marginHorizontal: 15 },
  emptyText:         { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },
  logRow:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  logIcon:           { fontSize: 22, marginRight: 10 },
  logInfo:           { flex: 1 },
  logType:           { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  logDate:           { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logBadge:          { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  logBadgeText:      { fontSize: 12, fontWeight: 'bold' },
  // Trend section
  // FIX #2 — alert has marginBottom so overview card is clearly separated
  alertBanner:       { backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#ffc107', padding: 12, marginHorizontal: 15, marginTop: 8, marginBottom: 14, borderRadius: 10 },
  alertTxt:          { color: '#856404', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  windowNotice:      { backgroundColor: '#fff3e0', paddingHorizontal: 15, paddingVertical: 8, marginTop: 4, marginBottom: 8 },
  windowNoticeTxt:   { fontSize: 12, color: '#e65100', fontWeight: '600' },
  trendHeaderRow:    { flexDirection: 'row', alignItems: 'center', paddingRight: 15 },
  periodRow:         { flexDirection: 'row', gap: 5, marginLeft: 'auto' },
  periodBtn:         { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  periodBtnOn:       { backgroundColor: colors.primary, borderColor: colors.primary },
  periodTxt:         { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  periodTxtOn:       { color: '#fff' },
  // FIX #2 — overview card top + bottom margin gives clear separation from alert and first vital card
  summaryCard:       { backgroundColor: colors.white, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  summaryTitle:      { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  summaryHint:       { fontSize: 11, color: colors.textSecondary, marginBottom: 12, fontStyle: 'italic' },
  summaryRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  summaryIcon:       { fontSize: 20, width: 28 },
  summaryLabel:      { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  summaryBadge:      { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  summaryBadgeTxt:   { fontSize: 11, fontWeight: '700' },
});

export default HealthStatusScreen;