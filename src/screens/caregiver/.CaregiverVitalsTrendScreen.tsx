// CaregiverVitalsTrendScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Fixed version:
//   • Period buttons (7d / 14d / 30d) actually refetch with that window
//   • Shows a banner when less data was available than requested
//     e.g. "Showing 7-day data — 30-day data not yet available"
//   • Handles vitals with errors (skips them gracefully)
//   • Loading state shows which window it's trying
// ─────────────────────────────────────────────────────────────────────────────

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
        const barH      = Math.max(4, Math.round(((v - minV) / rng) * (h - 8)) + 4);
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

// ─── Data-window banner ───────────────────────────────────────────────────────
// Shown per-card when the actual data window is smaller than requested.

const DataWindowBanner: React.FC<{
  requestedDays: number;
  actualDays: number | null;
  label: string;
}> = ({ requestedDays, actualDays, label }) => {
  // Don't show banner if data window matches request (or is larger)
  if (actualDays === null || actualDays >= requestedDays) return null;

  return (
    <View style={localStyles.windowBanner}>
      <Text style={localStyles.windowBannerTxt}>
        ⚡ Showing {label} — {requestedDays}-day data not yet available
      </Text>
    </View>
  );
};

// ─── Significance badge ───────────────────────────────────────────────────────

const SIG_STYLES: Record<string, { bg: string; text: string }> = {
  significant:       { bg: '#d4faf0', text: '#00b894' },
  marginal:          { bg: '#fff3cd', text: '#e67e22' },
  not_significant:   { bg: '#f0f0f0', text: '#636e72' },
  insufficient_data: { bg: '#f0f0f0', text: '#636e72' },
};

const SigBadge: React.FC<{ sig: string; note: string }> = ({ sig, note }) => {
  const s = SIG_STYLES[sig] || SIG_STYLES.not_significant;
  return (
    <View style={[localStyles.sigBox, { backgroundColor: s.bg }]}>
      <Text style={[localStyles.sigTxt, { color: s.text }]}>{note}</Text>
    </View>
  );
};

// ─── Individual vital card ────────────────────────────────────────────────────

const VitalTrendCard: React.FC<{ vital: VitalAnalysis; requestedDays: number }> = ({
  vital, requestedDays,
}) => {
  const [open, setOpen] = useState(false);
  const { regression: reg, stats, readings, trend_line, label, unit, log_type,
          data_window_days, data_window_label } = vital;

  if (vital.error) {
    return (
      <View style={[localStyles.card, { borderLeftColor: '#dfe6e9' }]}>
        <View style={localStyles.cardHeader}>
          <Text style={localStyles.cardIcon}>{VITAL_ICONS[log_type] || '📊'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={localStyles.cardTitle}>{label}</Text>
            <Text style={[localStyles.cardSummary, { color: '#e17055' }]}>{vital.error}</Text>
          </View>
        </View>
      </View>
    );
  }

  const sparkVals  = readings.slice(-14).map(r => r.numeric);
  const sparkTrend = trend_line.slice(-14);
  const n          = readings.length;

  return (
    <View style={[localStyles.card, { borderLeftColor: reg.trend_color }]}>

      {/* Data window banner */}
      <DataWindowBanner
        requestedDays={requestedDays}
        actualDays={data_window_days}
        label={data_window_label}
      />

      {/* Header */}
      <TouchableOpacity style={localStyles.cardHeader} onPress={() => setOpen(o => !o)} activeOpacity={0.85}>
        <Text style={localStyles.cardIcon}>{VITAL_ICONS[log_type] || '📊'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={localStyles.cardTitle}>{label}</Text>
          <Text style={localStyles.cardSummary}>{reg.summary}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <View style={[localStyles.badge, { backgroundColor: reg.trend_color + '22', borderColor: reg.trend_color }]}>
            <Text style={[localStyles.badgeTxt, { color: reg.trend_color }]}>{reg.trend_label}</Text>
          </View>
          <Text style={localStyles.expandHint}>{open ? '▲ Less' : '▼ Details'}</Text>
        </View>
      </TouchableOpacity>

      {/* Sparkline */}
      <Sparkline values={sparkVals} trendLine={sparkTrend} color={reg.trend_color} />

      {/* Stat strip */}
      <View style={localStyles.statStrip}>
        {[
          { l: 'Latest', v: stats.latest,  c: reg.trend_color },
          { l: 'Avg',    v: stats.avg,     c: undefined },
          { l: 'Min',    v: stats.min,     c: '#00b894' },
          { l: 'Max',    v: stats.max,     c: '#e17055' },
          { l: 'Days',   v: stats.count,   c: undefined },
        ].map((s, i) => (
          <React.Fragment key={s.l}>
            {i > 0 && <View style={localStyles.stripDivider} />}
            <View style={localStyles.stripCell}>
              <Text style={[localStyles.stripVal, s.c ? { color: s.c } : {}]}>{s.v}</Text>
              <Text style={localStyles.stripLbl}>{s.l}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      <Text style={localStyles.unitNote}>{unit} · {NORMAL_RANGES[log_type]}</Text>

      {/* Expanded section */}
      {open && (
        <View style={localStyles.expanded}>
          <Text style={localStyles.secHead}>📐 Regression (scipy.stats.linregress)</Text>
          <View style={localStyles.metricsGrid}>
            {[
              ['Change/Week',      `${reg.change_per_week > 0 ? '+' : ''}${reg.change_per_week} ${unit}`],
              ['Slope/Day',        `${reg.slope > 0 ? '+' : ''}${reg.slope}`],
              ['R²',               `${reg.r_squared}`],
              ['p-value',          `${reg.p_value}`],
              ['Predicted Today',  `${reg.predicted_today} ${unit}`],
              ['Std Dev',          `${stats.std}`],
              ['Median',           `${stats.median} ${unit}`],
              ['95% CI ±',         `${reg.conf_95}`],
            ].map(([lbl, val]) => (
              <View key={lbl as string} style={localStyles.metricBox}>
                <Text style={localStyles.metricVal}>{val}</Text>
                <Text style={localStyles.metricLbl}>{lbl}</Text>
              </View>
            ))}
          </View>

          <SigBadge sig={reg.significance} note={reg.significance_note} />

          <Text style={localStyles.secHead}>📅 Reading History ({n} readings · {data_window_label})</Text>
          <View style={localStyles.tblHead}>
            <Text style={[localStyles.tblCell, localStyles.tblHd, { flex: 1.4 }]}>Date</Text>
            <Text style={[localStyles.tblCell, localStyles.tblHd]}>Value</Text>
            <Text style={[localStyles.tblCell, localStyles.tblHd]}>vs Avg</Text>
            <Text style={[localStyles.tblCell, localStyles.tblHd]}>Trend Y</Text>
          </View>
          {[...readings].reverse().map((r, i) => {
            const diff    = parseFloat((r.numeric - stats.avg).toFixed(2));
            const diffTxt = diff > 0 ? `+${diff}` : `${diff}`;
            const diffClr = Math.abs(diff) < 3
              ? colors.textSecondary : diff > 0 ? '#e17055' : '#0984e3';
            const trendY  = trend_line[n - 1 - i];
            return (
              <View key={i} style={[localStyles.tblRow, i % 2 === 0 && localStyles.tblRowAlt]}>
                <Text style={[localStyles.tblCell, { flex: 1.4 }]}>{r.date}</Text>
                <Text style={[localStyles.tblCell, { fontWeight: '600' }]}>{r.value} {unit}</Text>
                <Text style={[localStyles.tblCell, { color: diffClr, fontWeight: '600' }]}>{diffTxt}</Text>
                <Text style={[localStyles.tblCell, { color: '#636e72' }]}>{trendY}</Text>
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

  const [vitals,     setVitals]     = useState<VitalAnalysis[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');
  const [days,       setDays]       = useState<7 | 14 | 30>(30);

  // Track the actual window returned by the server (may differ from `days`)
  const [actualWindow, setActualWindow] = useState<string | null>(null);

  const fetchTrends = useCallback(async () => {
    setLoading(true);
    setError('');
    setActualWindow(null);
    try {
      // Pass `days` as a query param — Node will fall back if data is sparse
      const res  = await fetch(
        getApiUrl(`/api/health-trends/report/${elderId}?days=${days}`)
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch trends');

      const arr = Array.isArray(data) ? data : [];

      // Sort by VITAL_ORDER
      const sorted = arr
        .filter((v: VitalAnalysis) => !v.error || v.error)  // keep all including errors
        .sort((a: VitalAnalysis, b: VitalAnalysis) =>
          VITAL_ORDER.indexOf(a.log_type) - VITAL_ORDER.indexOf(b.log_type)
        );
      setVitals(sorted);

      // Pick the smallest actual window across all returned vitals
      const windows = sorted
        .map((v: VitalAnalysis) => v.data_window_days)
        .filter((w: number | null) => w !== null && w !== undefined) as number[];
      if (windows.length) {
        const minWindow = Math.min(...windows);
        if (minWindow < days) {
          setActualWindow(`Showing ${minWindow}-day data (${days}-day data not yet available)`);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [elderId, days]);

  useEffect(() => { fetchTrends(); }, [fetchTrends]);

  const onRefresh = () => { setRefreshing(true); fetchTrends(); };

  const goodVitals  = vitals.filter(v => !v.error && v.readings?.length >= 2);
  const risingList  = goodVitals.filter(v => v.regression?.trend === 'rising');

  return (
    <SafeAreaView style={screenStyles.container}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={screenStyles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={{ padding: 4, marginRight: 8 }}>
          <Text style={{ fontSize: 20, color: colors.primary }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={screenStyles.headerTitle}>Trend Analysis</Text>
          <Text style={screenStyles.headerSub}>{elderName} · scipy linregress</Text>
        </View>
        {/* Period selector */}
        <View style={screenStyles.periodRow}>
          {([7, 14, 30] as const).map(d => (
            <TouchableOpacity key={d}
              style={[screenStyles.periodBtn, days === d && screenStyles.periodBtnOn]}
              onPress={() => { if (d !== days) setDays(d); }}>
              <Text style={[screenStyles.periodTxt, days === d && screenStyles.periodTxtOn]}>{d}d</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Actual window notice ─────────────────────────────────────────────── */}
      {!loading && actualWindow && (
        <View style={screenStyles.windowNotice}>
          <Text style={screenStyles.windowNoticeTxt}>⚡ {actualWindow}</Text>
        </View>
      )}

      {/* ── Rising trend alert ───────────────────────────────────────────────── */}
      {!loading && risingList.length > 0 && (
        <View style={screenStyles.alertBanner}>
          <Text style={screenStyles.alertTxt}>
            ⚠️ {risingList.map(v => v.label).join(', ')} {risingList.length > 1 ? 'are' : 'is'} trending up — review recommended.
          </Text>
        </View>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={screenStyles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={screenStyles.loadTxt}>Running regression analysis…</Text>
          <Text style={screenStyles.loadSub}>Trying {days}-day window first, falling back if needed</Text>
        </View>
      ) : error ? (
        <View style={screenStyles.center}>
          <Text style={screenStyles.errTxt}>⚠️ {error}</Text>
          <TouchableOpacity style={screenStyles.retryBtn} onPress={fetchTrends}>
            <Text style={screenStyles.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : vitals.length === 0 ? (
        <View style={screenStyles.center}>
          <Text style={{ fontSize: 56, marginBottom: 16 }}>📊</Text>
          <Text style={screenStyles.emptyTitle}>No health data yet</Text>
          <Text style={screenStyles.emptyTxt}>
            {elderName} hasn't logged any vitals yet.{'\n'}
            At least 2 readings of any vital are needed to show trends.
          </Text>
          <TouchableOpacity style={[screenStyles.retryBtn, { marginTop: 20 }]} onPress={fetchTrends}>
            <Text style={screenStyles.retryTxt}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={screenStyles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          {/* Summary strip */}
          <View style={screenStyles.summaryCard}>
            <Text style={screenStyles.summaryTitle}>
              📈 Trend Summary · {actualWindow ? 'Mixed windows' : `Last ${days} days`}
            </Text>
            {goodVitals.map(v => (
              <View key={v.log_type} style={screenStyles.summaryRow}>
                <Text style={screenStyles.summaryIcon}>{VITAL_ICONS[v.log_type] || '📊'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={screenStyles.summaryLabel}>{v.label}</Text>
                  {v.data_window_days !== null && v.data_window_days < days && (
                    <Text style={screenStyles.summaryWindowNote}>({v.data_window_label})</Text>
                  )}
                </View>
                <View style={[screenStyles.summaryBadge, {
                  backgroundColor: v.regression.trend_color + '22',
                  borderColor:     v.regression.trend_color,
                }]}>
                  <Text style={[screenStyles.summaryBadgeTxt, { color: v.regression.trend_color }]}>
                    {v.regression.trend_label}
                  </Text>
                </View>
              </View>
            ))}
            <Text style={screenStyles.tapHint}>Tap any card below for full regression detail</Text>
          </View>

          {/* One card per vital */}
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

const localStyles = StyleSheet.create({
  card:         { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginBottom: 14, borderLeftWidth: 5, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardHeader:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  cardIcon:     { fontSize: 30, marginTop: 2 },
  cardTitle:    { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  cardSummary:  { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  expandHint:   { fontSize: 11, color: colors.textSecondary },
  badge:        { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt:     { fontSize: 11, fontWeight: '700' },
  statStrip:    { flexDirection: 'row', backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, marginBottom: 4 },
  stripCell:    { flex: 1, alignItems: 'center' },
  stripVal:     { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  stripLbl:     { fontSize: 10, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase' },
  stripDivider: { width: 1, backgroundColor: colors.border },
  unitNote:     { fontSize: 10, color: colors.textSecondary, marginBottom: 6 },
  expanded:     { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  secHead:      { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  metricsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metricBox:    { backgroundColor: colors.background, borderRadius: 10, padding: 10, alignItems: 'center', minWidth: '22%', flex: 1 },
  metricVal:    { fontSize: 13, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  metricLbl:    { fontSize: 9, color: colors.textSecondary, marginTop: 3, textAlign: 'center' },
  sigBox:       { borderRadius: 10, padding: 10, marginBottom: 12 },
  sigTxt:       { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  tblHead:      { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1.5, borderBottomColor: colors.border },
  tblHd:        { fontWeight: '700', color: colors.textSecondary, fontSize: 10, textTransform: 'uppercase' },
  tblRow:       { flexDirection: 'row', paddingVertical: 7 },
  tblRowAlt:    { backgroundColor: '#f9f9f9' },
  tblCell:      { flex: 1, fontSize: 12, color: colors.textPrimary },
  windowBanner: { backgroundColor: '#fff8e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#f9a825' },
  windowBannerTxt: { fontSize: 11, color: '#e65100', fontWeight: '600' },
});

const screenStyles = StyleSheet.create({
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
  loadTxt:         { marginTop: 12, fontSize: 15, color: colors.textSecondary },
  loadSub:         { marginTop: 5, fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  errTxt:          { color: '#e17055', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn:        { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  retryTxt:        { color: '#fff', fontWeight: '700' },
  emptyTitle:      { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  emptyTxt:        { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  summaryCard:     { backgroundColor: colors.white, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  summaryTitle:    { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  summaryRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  summaryIcon:     { fontSize: 20, width: 28 },
  summaryLabel:    { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  summaryWindowNote: { fontSize: 10, color: '#e65100', marginTop: 1 },
  summaryBadge:    { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  summaryBadgeTxt: { fontSize: 11, fontWeight: '700' },
  tapHint:         { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
});

export default CaregiverVitalsTrendScreen;