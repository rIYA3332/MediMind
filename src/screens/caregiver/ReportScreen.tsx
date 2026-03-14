// ReportScreen.tsx — Comprehensive Caregiver Health Report
// Real data · Custom charts · User-friendly language · Full summary

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl, Modal, Alert, Linking, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import VitalChart, { TrendPoint } from '../../components/Vitalchart';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

const SCREEN_W = Dimensions.get('window').width;

// ── Types ──────────────────────────────────────────────────────────────────────
interface Report {
  medications: { total: number; taken: number; partial?: number; missed?: number };
  healthLogs:  Array<{ log_type: string; count: number; avg_value: number; max_value: string; min_value: string }>;
  mood:        Array<{ mood: string; count: number }>;
  alerts:      { alert_count: number };
  risks:       Array<{ risk_type: string; severity: string; message: string; detected_at: string }>;
  activity:    Array<{ activity_type: string; count: number; day: string }>;
  dateRange?:  { startDate: string; endDate: string; days: number };
}

interface AdherenceSummary {
  overall_pct: number | null;
  total_meds: number;
  critical_meds: number;
  warning_meds: number;
  worst_med: { title: string; adherence_pct: number; days_missed: number; days_due: number } | null;
  medications: Array<{
    id: number; title: string; type: string; scheduled_time: string;
    days_due: number; days_taken: number; days_partial: number; days_missed: number;
    adherence_pct: number;
  }>;
}

interface VitalAnalysis {
  log_type: string; label: string; unit: string;
  readings: Array<{ date: string; value: string; numeric: number }>;
  regression: { slope: number; trend: string; trend_color: string; change_per_week: number; predicted_today: number; summary: string };
  stats: { min: number; max: number; avg: number; latest: number; count: number };
  clinical_status?: { zone: string; label: string; color: string };
  error?: string;
}

interface AIRisk {
  assessment?: { reasons: string[]; risk_level?: string };
}

type ReportMode = 'daily' | 'weekly' | 'yearly';
type DatePreset = '7' | '14' | '30' | 'custom';
type Section    = 'summary' | 'medications' | 'vitals' | 'mood' | 'risks' | 'activity';

// ── Helpers ────────────────────────────────────────────────────────────────────
const toISO       = (d: Date) => d.toISOString().split('T')[0];
const addDays     = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const startOfYear = (y: number) => `${y}-01-01`;
const endOfYear   = (y: number) => `${y}-12-31`;
const fmtShort    = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtFull     = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const healthIcons: Record<string, string> = {
  blood_pressure: '🩺', blood_sugar: '🩸', weight: '⚖️', temperature: '🌡️', heart_rate: '❤️',
};
const moodEmojis: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢', anxious: '😰', tired: '😴', lonely: '🪑',
};
const vitalColors: Record<string, string> = {
  blood_pressure: '#e17055', blood_sugar: '#6c5ce7', heart_rate: '#ff4757',
  temperature: '#fd79a8', weight: '#00b894',
};
const vitalUnits: Record<string, string> = {
  blood_pressure: 'mmHg', blood_sugar: 'mg/dL', heart_rate: 'bpm', temperature: '°F', weight: 'kg',
};

const SECTIONS: { key: Section; label: string; icon: string }[] = [
  { key: 'summary',     label: 'Summary',     icon: '📊' },
  { key: 'medications', label: 'Medications', icon: '💊' },
  { key: 'vitals',      label: 'Vitals',      icon: '❤️' },
  { key: 'mood',        label: 'Mood',        icon: '😊' },
  { key: 'risks',       label: 'Risks',       icon: '⚠️' },
  { key: 'activity',    label: 'Activity',    icon: '📅' },
];

// ── Custom Chart Components ────────────────────────────────────────────────────

// Donut / ring progress
const DonutRing: React.FC<{ pct: number; size?: number; color: string; label: string; sublabel?: string }> = ({
  pct, size = 90, color, label, sublabel
}) => {
  const filled = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 8, borderColor: '#f0f2f5' }} />
      <View style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 8, borderColor: 'transparent',
        borderTopColor: color,
        borderRightColor: filled > 25 ? color : 'transparent',
        borderBottomColor: filled > 50 ? color : 'transparent',
        borderLeftColor: filled > 75 ? color : 'transparent',
        transform: [{ rotate: '-90deg' }],
      }} />
      <Text style={{ fontSize: size * 0.2, fontWeight: '800', color, textAlign: 'center' }}>{label}</Text>
      {sublabel ? <Text style={{ fontSize: size * 0.11, color: colors.textSecondary, textAlign: 'center' }}>{sublabel}</Text> : null}
    </View>
  );
};

// Mini horizontal bar
const MiniBar: React.FC<{ value: number; max: number; color: string; label: string; suffix?: string }> = ({
  value, max, color, label, suffix = ''
}) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ fontSize: 12, color: colors.textPrimary, fontWeight: '600' }}>{label}</Text>
        <Text style={{ fontSize: 12, color, fontWeight: '700' }}>{value}{suffix}</Text>
      </View>
      <View style={{ height: 7, backgroundColor: '#f0f2f5', borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
};

// Stacked bar for medication breakdown
const MedStackBar: React.FC<{ taken: number; partial: number; missed: number; total: number }> = ({
  taken, partial, missed, total
}) => {
  if (total === 0) return null;
  const takenW   = `${Math.round((taken / total) * 100)}%` as any;
  const partialW = `${Math.round((partial / total) * 100)}%` as any;
  const missedW  = `${Math.round((missed / total) * 100)}%` as any;
  return (
    <View>
      <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 6 }}>
        {taken > 0   && <View style={{ width: takenW,   backgroundColor: '#00b894' }} />}
        {partial > 0 && <View style={{ width: partialW, backgroundColor: '#fdcb6e' }} />}
        {missed > 0  && <View style={{ width: missedW,  backgroundColor: '#ff7675' }} />}
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#00b894' }} />
          <Text style={{ fontSize: 11, color: colors.textSecondary }}>Taken ({taken})</Text>
        </View>
        {partial > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fdcb6e' }} />
            <Text style={{ fontSize: 11, color: colors.textSecondary }}>Partial ({partial})</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff7675' }} />
          <Text style={{ fontSize: 11, color: colors.textSecondary }}>Missed ({missed})</Text>
        </View>
      </View>
    </View>
  );
};

// Sparkline bar chart
const SparkBars: React.FC<{ values: number[]; color: string; height?: number }> = ({ values, color, height = 40 }) => {
  if (!values.length) return null;
  const max = Math.max(...values) || 1;
  const barW = Math.max(4, Math.floor(((SCREEN_W - 120) / values.length) - 3));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 3, marginVertical: 6 }}>
      {values.map((v, i) => (
        <View key={i} style={{
          width: barW, borderRadius: 3,
          height: Math.max(4, Math.round((v / max) * (height - 6)) + 4),
          backgroundColor: color,
          opacity: 0.7 + (i / values.length) * 0.3,
        }} />
      ))}
    </View>
  );
};

// Mood pie segment approximation (using colored blocks)
const MoodDistribution: React.FC<{ moodData: Array<{ mood: string; count: number }> }> = ({ moodData }) => {
  const total = moodData.reduce((a, m) => a + m.count, 0);
  if (!total) return null;
  const getMoodColor = (m: string) => ({
    happy: '#00b894', neutral: '#74b9ff', sad: '#ff7675',
    anxious: '#fdcb6e', tired: '#a29bfe', lonely: '#fd79a8',
  }[m] || '#b2bec3');
  return (
    <View>
      <View style={{ flexDirection: 'row', height: 20, borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
        {moodData.map(item => {
          const pct = (item.count / total) * 100;
          return pct > 0 ? (
            <View key={item.mood} style={{ width: `${pct}%` as any, backgroundColor: getMoodColor(item.mood) }} />
          ) : null;
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {moodData.map(item => {
          const pct = Math.round((item.count / total) * 100);
          return (
            <View key={item.mood} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14 }}>{moodEmojis[item.mood] || '😐'}</Text>
              <Text style={{ fontSize: 11, color: colors.textPrimary, fontWeight: '600' }}>
                {item.mood.charAt(0).toUpperCase() + item.mood.slice(1)}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textSecondary }}>{pct}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ── FIX 1: Health Score Card with corrected score formula ─────────────────────
// The score was hitting 0 because riskPenalty had no cap.
// Now: riskPenalty is capped at 40 so the score always stays meaningful.
const HealthScoreCard: React.FC<{
  score: number; adherencePct: number; criticalRisks: number;
  moodScore: number; vitalStability: number;
}> = ({ score, adherencePct, criticalRisks, moodScore, vitalStability }) => {
  const color = score >= 80 ? '#00b894' : score >= 60 ? '#fdcb6e' : score >= 40 ? '#e17055' : '#ff4757';
  const label = score >= 80 ? 'Great' : score >= 60 ? 'Fair' : score >= 40 ? 'Needs Attention' : 'Critical';
  const emoji = score >= 80 ? '🏆' : score >= 60 ? '👍' : score >= 40 ? '⚠️' : '🚨';

  return (
    <View style={[SS.scoreCard, { borderColor: color + '44' }]}>
      {/* Left — donut */}
      <View style={SS.scoreLeft}>
        <DonutRing pct={score} size={90} color={color} label={`${score}`} sublabel="/ 100" />
      </View>

      {/* Right — breakdown */}
      <View style={SS.scoreRight}>
        <Text style={[SS.scoreLabel, { color }]}>{emoji} {label}</Text>
        <Text style={SS.scoreHint}>Overall health for this period</Text>

        <View style={{ gap: 4, marginTop: 8 }}>
          <MiniBar value={adherencePct}   max={100} color="#00b894" label="💊 Medication"  suffix="%" />
          <MiniBar value={moodScore}      max={100} color="#74b9ff" label="😊 Mood"        suffix="%" />
          <MiniBar value={vitalStability} max={100} color="#6c5ce7" label="❤️ Vitals"      suffix="%" />
        </View>

        {criticalRisks > 0 && (
          <View style={SS.criticalNote}>
            <Text style={SS.criticalNoteText}>
              🚨 {criticalRisks} critical alert{criticalRisks > 1 ? 's' : ''} — see Risks tab
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const SS = StyleSheet.create({
  scoreCard:       { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 16, padding: 16, borderWidth: 1.5, marginBottom: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8 },
  scoreLeft:       { marginRight: 16, justifyContent: 'center' },
  scoreRight:      { flex: 1, justifyContent: 'center' },
  scoreLabel:      { fontSize: 17, fontWeight: '800', marginBottom: 1 },
  scoreHint:       { fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
  criticalNote:    { marginTop: 8, backgroundColor: '#fff0f0', borderRadius: 8, padding: 6, borderWidth: 1, borderColor: '#ff7675' },
  criticalNoteText:{ fontSize: 11, color: '#c0392b', fontWeight: '700' },
});

// Insight pill
const InsightPill: React.FC<{ icon: string; text: string; type: 'good' | 'warn' | 'bad' | 'info' }> = ({ icon, text, type }) => {
  const cfg = {
    good: { bg: '#d4faf0', border: '#00b894', text: '#00695c' },
    warn: { bg: '#fff8e1', border: '#fdcb6e', text: '#7d5a00' },
    bad:  { bg: '#fff0f0', border: '#ff7675', text: '#c0392b' },
    info: { bg: '#e8f4ff', border: '#74b9ff', text: '#1e6ba0' },
  }[type];
  return (
    <View style={[IP.pill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <Text style={IP.icon}>{icon}</Text>
      <Text style={[IP.text, { color: cfg.text }]}>{text}</Text>
    </View>
  );
};
const IP = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 7 },
  icon: { fontSize: 16, marginTop: 1 },
  text: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 19 },
});

// ── FIX 2: Collapsible Medication Row ─────────────────────────────────────────
const CollapsibleMedRow: React.FC<{
  med: AdherenceSummary['medications'][0]
}> = ({ med }) => {
  const [open, setOpen] = useState(false);
  const mc = med.adherence_pct >= 90 ? '#00b894' : med.adherence_pct >= 70 ? '#fdcb6e' : '#ff7675';
  const ml = med.adherence_pct >= 90 ? 'On track ✓' : med.adherence_pct >= 70 ? 'Needs attention' : 'Low adherence';

  const formatTime = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  return (
    <View style={CMR.wrapper}>
      {/* Header row — always visible, tap to expand */}
      <TouchableOpacity style={CMR.header} onPress={() => setOpen(o => !o)} activeOpacity={0.75}>
        <Text style={{ fontSize: 20 }}>
          {med.type === 'medicine' ? '💊' : med.type === 'appointment' ? '🏥' : '🌿'}
        </Text>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={CMR.title} numberOfLines={1}>{med.title}</Text>
          <Text style={CMR.time}>🕐 {formatTime(med.scheduled_time)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
          <Text style={[CMR.pct, { color: mc }]}>
            {isNaN(med.adherence_pct) ? '—' : `${med.adherence_pct}%`}
          </Text>
          <Text style={{ fontSize: 10, color: mc }}>{ml}</Text>
        </View>
        <Text style={[CMR.chevron, { transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
      </TouchableOpacity>

      {/* Expandable detail */}
      {open && (
        <View style={CMR.detail}>
          <MedStackBar taken={med.days_taken} partial={med.days_partial} missed={med.days_missed} total={med.days_due} />
          <View style={CMR.statsRow}>
            <View style={CMR.statBox}><Text style={[CMR.statVal, { color: '#00b894' }]}>{med.days_taken}</Text><Text style={CMR.statLbl}>Taken</Text></View>
            {med.days_partial > 0 && <View style={CMR.statBox}><Text style={[CMR.statVal, { color: '#fdcb6e' }]}>{med.days_partial}</Text><Text style={CMR.statLbl}>Partial</Text></View>}
            <View style={CMR.statBox}><Text style={[CMR.statVal, { color: '#ff7675' }]}>{med.days_missed}</Text><Text style={CMR.statLbl}>Missed</Text></View>
            <View style={CMR.statBox}><Text style={[CMR.statVal, { color: colors.primary }]}>{med.days_due}</Text><Text style={CMR.statLbl}>Total</Text></View>
          </View>
          {med.adherence_pct < 70 && (
            <View style={CMR.tipBox}>
              <Text style={CMR.tipText}>💡 Tip: Try adjusting the reminder time or check for any side effects with the caregiver team.</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const CMR = StyleSheet.create({
  wrapper:  { borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 8, overflow: 'hidden', backgroundColor: colors.white },
  header:   { flexDirection: 'row', alignItems: 'center', padding: 12 },
  title:    { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  time:     { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  pct:      { fontSize: 17, fontWeight: '800' },
  chevron:  { fontSize: 20, color: colors.textSecondary, fontWeight: '300' },
  detail:   { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#f0f2f5' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  statBox:  { flex: 1, backgroundColor: colors.background, borderRadius: 8, padding: 8, alignItems: 'center' },
  statVal:  { fontSize: 16, fontWeight: '800' },
  statLbl:  { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  tipBox:   { marginTop: 10, backgroundColor: '#fff8e1', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#fdcb6e' },
  tipText:  { fontSize: 12, color: '#7d5a00', fontWeight: '600', lineHeight: 18 },
});

// ── FIX 3: Improved Vital Sign Card ───────────────────────────────────────────
const VitalSnapshotCard: React.FC<{ vital: VitalAnalysis }> = ({ vital }) => {
  const tc = vital.regression.trend === 'rising' ? '#e17055' : vital.regression.trend === 'falling' ? '#0984e3' : '#00b894';
  const tl = vital.regression.trend === 'rising' ? '↑ Going Up' : vital.regression.trend === 'falling' ? '↓ Going Down' : '→ Stable';
  const cz = vital.clinical_status;
  const vColor = vitalColors[vital.log_type] || '#6c5ce7';
  const changeAbs = Math.abs(vital.regression.change_per_week);

  return (
    <View style={VSC.card}>
      {/* Top row: icon + name + trend badge */}
      <View style={VSC.topRow}>
        <View style={[VSC.iconCircle, { backgroundColor: vColor + '18' }]}>
          <Text style={{ fontSize: 18 }}>{healthIcons[vital.log_type] || '📊'}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={VSC.vitalName}>{vital.label}</Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary }}>{vital.stats.count} reading{vital.stats.count !== 1 ? 's' : ''} recorded</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={[VSC.trendBadge, { backgroundColor: tc + '18', borderColor: tc }]}>
            <Text style={[VSC.trendText, { color: tc }]}>{tl}</Text>
          </View>
          {cz && (
            <View style={[VSC.zoneBadge, { backgroundColor: cz.color + '18' }]}>
              <Text style={[VSC.zoneText, { color: cz.color }]}>{cz.label}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Stats row */}
      <View style={VSC.statsRow}>
        <View style={[VSC.statPill, { borderColor: vColor + '44', backgroundColor: vColor + '0d' }]}>
          <Text style={[VSC.statBig, { color: vColor }]}>{vital.stats.latest}</Text>
          <Text style={VSC.statUnit}>{vital.unit}</Text>
          <Text style={VSC.statCaption}>Latest</Text>
        </View>
        <View style={VSC.statDivider} />
        <View style={VSC.statPlain}>
          <Text style={VSC.statSmall}>{vital.stats.avg}</Text>
          <Text style={VSC.statCaption}>Average</Text>
        </View>
        <View style={VSC.statDivider} />
        <View style={VSC.statPlain}>
          <Text style={[VSC.statSmall, { color: '#00b894' }]}>{vital.stats.min}</Text>
          <Text style={VSC.statCaption}>Lowest</Text>
        </View>
        <View style={VSC.statDivider} />
        <View style={VSC.statPlain}>
          <Text style={[VSC.statSmall, { color: '#e17055' }]}>{vital.stats.max}</Text>
          <Text style={VSC.statCaption}>Highest</Text>
        </View>
      </View>

      {/* Sparkline */}
      {vital.readings.length > 1 && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 10, color: colors.textSecondary, marginBottom: 2 }}>Last {Math.min(vital.readings.length, 10)} readings</Text>
          <SparkBars values={vital.readings.slice(-10).map(r => r.numeric)} color={vColor} height={36} />
        </View>
      )}

      {/* Change note */}
      {changeAbs > 0 && vital.regression.trend !== 'stable' && (
        <Text style={{ fontSize: 11, color: tc, fontWeight: '600', marginTop: 4 }}>
          {vital.regression.trend === 'rising' ? '↑ Increasing' : '↓ Decreasing'} by ~{changeAbs} {vital.unit}/week
        </Text>
      )}
    </View>
  );
};

const VSC = StyleSheet.create({
  card:       { backgroundColor: colors.white, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  topRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  vitalName:  { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  trendBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  trendText:  { fontSize: 11, fontWeight: '700' },
  zoneBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  zoneText:   { fontSize: 10, fontWeight: '600' },
  statsRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f9fc', borderRadius: 10, padding: 10, marginBottom: 4 },
  statPill:   { alignItems: 'center', flex: 1.3, borderWidth: 1, borderRadius: 8, paddingVertical: 6 },
  statBig:    { fontSize: 18, fontWeight: '800' },
  statUnit:   { fontSize: 9, color: colors.textSecondary, marginTop: -2 },
  statCaption:{ fontSize: 10, color: colors.textSecondary, marginTop: 1 },
  statDivider:{ width: 1, height: 36, backgroundColor: '#e0e4ea', marginHorizontal: 6 },
  statPlain:  { flex: 1, alignItems: 'center' },
  statSmall:  { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
});

// ── Main Component ─────────────────────────────────────────────────────────────
const ReportScreen = ({ route, navigation }: any) => {
  const { elderId, elderName } = route.params || {};

  const [mode, setMode]                 = useState<ReportMode>('weekly');
  const todayISO                        = toISO(new Date());
  const [startDate, setStartDate]       = useState(() => toISO(addDays(new Date(), -6)));
  const [endDate, setEndDate]           = useState(todayISO);
  const [preset, setPreset]             = useState<DatePreset>('7');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showPicker, setShowPicker]     = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end'>('start');
  const [activeSection, setActiveSection] = useState<Section>('summary');

  // Data states
  const [report,          setReport]          = useState<Report | null>(null);
  const [trends,          setTrends]          = useState<Record<string, TrendPoint[]>>({});
  const [adherence,       setAdherence]       = useState<AdherenceSummary | null>(null);
  const [vitalAnalyses,   setVitalAnalyses]   = useState<VitalAnalysis[]>([]);
  const [aiInsights,      setAiInsights]      = useState<string[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [downloading,     setDownloading]     = useState(false);

  // FIX 4: Collapsible "Per Medication" in Overview
  const [medBreakdownOpen, setMedBreakdownOpen] = useState(false);

  // ── Date range ───────────────────────────────────────────────────────────────
  const computedRange = useCallback((): { s: string; e: string } => {
    if (mode === 'daily')  return { s: endDate, e: endDate };
    if (mode === 'yearly') return { s: startOfYear(selectedYear), e: endOfYear(selectedYear) };
    return { s: startDate, e: endDate };
  }, [mode, startDate, endDate, selectedYear]);

  // ── Fetch all data ────────────────────────────────────────────────────────────
  const fetchTrends = useCallback(async (s: string, e: string, logTypes: string[]) => {
    if (!elderId || !logTypes.length) return;
    const results: Record<string, TrendPoint[]> = {};
    await Promise.all(logTypes.map(async (type) => {
      try {
        const r = await fetch(getApiUrl(`/api/health-trends/${elderId}/${type}?startDate=${s}&endDate=${e}`));
        const d = await r.json();
        results[type] = (Array.isArray(d) ? d : []).map((row: any) => ({
          value: row.numericValue != null ? Number(row.numericValue) : Number(row.value ?? 0),
          label: new Date(row.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          systolic:  row.systolic  != null ? Number(row.systolic)  : null,
          diastolic: row.diastolic != null ? Number(row.diastolic) : null,
        }));
      } catch { results[type] = []; }
    }));
    setTrends(results);
  }, [elderId]);

  const fetchAdherence = useCallback(async (days: number) => {
    if (!elderId) return;
    try {
      const res  = await fetch(getApiUrl(`/api/adherence/summary/${elderId}?days=${days}`));
      const data = await res.json();
      setAdherence(data);
    } catch { setAdherence(null); }
  }, [elderId]);

  const fetchVitalAnalyses = useCallback(async (days: number) => {
    if (!elderId) return;
    try {
      const res  = await fetch(getApiUrl(`/api/health-trends/report/${elderId}?days=${days}`));
      const data = await res.json();
      setVitalAnalyses(Array.isArray(data) ? data : []);
    } catch { setVitalAnalyses([]); }
  }, [elderId]);

  const fetchAIInsights = useCallback(async () => {
    if (!elderId) return;
    try {
      const res  = await fetch(getApiUrl(`/api/health-risks/ai/${elderId}`));
      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
      const data = JSON.parse(trimmed);
      setAiInsights(data?.assessment?.reasons || []);
    } catch { setAiInsights([]); }
  }, [elderId]);

  const fetchReport = useCallback(async () => {
    if (!elderId) return;
    setLoading(true);
    const { s, e } = computedRange();
    const days = mode === 'daily' ? 1 : mode === 'yearly' ? 365
      : Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1;

    try {
      const res  = await fetch(getApiUrl(`/api/reports/weekly/${elderId}?startDate=${s}&endDate=${e}`));
      const data = await res.json();
      setReport(data);
      const logTypes = (data?.healthLogs || []).map((l: any) => l.log_type);
      await Promise.all([
        fetchTrends(s, e, logTypes),
        fetchAdherence(Math.min(days, 30)),
        fetchVitalAnalyses(Math.min(days, 30)),
        fetchAIInsights(),
      ]);
    } catch (err) { console.log('Report fetch error:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [elderId, computedRange, fetchTrends, fetchAdherence, fetchVitalAnalyses, fetchAIInsights]);

  useEffect(() => { fetchReport(); }, [mode, startDate, endDate, selectedYear]);

  const onRefresh = () => { setRefreshing(true); fetchReport(); };

  // ── Preset ────────────────────────────────────────────────────────────────────
  const applyPreset = (p: DatePreset) => {
    if (p === 'custom') { setPreset('custom'); return; }
    setPreset(p);
    const d = parseInt(p);
    setStartDate(toISO(addDays(new Date(), -(d - 1))));
    setEndDate(toISO(new Date()));
  };

  // ── Download PDF ─────────────────────────────────────────────────────────────
  const downloadPDF = async () => {
    setDownloading(true);
    const { s, e } = computedRange();
    try {
      const url = getApiUrl(`/api/reports/pdf/${elderId}?startDate=${s}&endDate=${e}`);
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
      else Alert.alert('Error', 'Cannot open PDF download link.');
    } catch { Alert.alert('Download Failed', 'Please try again.'); }
    finally { setDownloading(false); }
  };

  // ── Derived values ────────────────────────────────────────────────────────────
  const adherencePct   = adherence?.overall_pct ?? (
    !report || !report.medications.total ? 0
    : Math.round((report.medications.taken / report.medications.total) * 100)
  );
  const adherenceClr   = adherencePct >= 90 ? '#00b894' : adherencePct >= 70 ? '#fdcb6e' : '#ff7675';
  const adherenceLabel = adherencePct >= 90 ? 'Excellent' : adherencePct >= 70 ? 'Good' : 'Needs Attention';

  const criticalRisks  = report?.risks.filter(r => r.severity === 'critical').length || 0;
  const dangerRisks    = report?.risks.filter(r => r.severity === 'danger').length   || 0;
  const totalRisks     = (report?.risks || []).length;

  const moodTotal      = report?.mood.reduce((a, m) => a + m.count, 0) || 0;
  const happyCount     = report?.mood.filter(m => m.mood === 'happy').reduce((a, m) => a + m.count, 0) || 0;
  const neutralCount   = report?.mood.filter(m => m.mood === 'neutral').reduce((a, m) => a + m.count, 0) || 0;
  const negMoodCount   = report?.mood.filter(m => ['sad','lonely','anxious'].includes(m.mood)).reduce((a, m) => a + m.count, 0) || 0;
  const moodScore      = moodTotal > 0 ? Math.round(((happyCount + neutralCount * 0.5) / moodTotal) * 100) : 50;

  const goodVitals     = vitalAnalyses.filter(v => !v.error && v.readings?.length >= 2);
  const stableVitals   = goodVitals.filter(v => v.regression?.trend === 'stable').length;
  const risingVitals   = goodVitals.filter(v => v.regression?.trend === 'rising');
  const vitalStability = goodVitals.length > 0 ? Math.round((stableVitals / goodVitals.length) * 100) : 70;

  // ── FIX: Health Score — cap riskPenalty so score never unfairly hits 0 ──────
  const riskPenalty    = Math.min(40, criticalRisks * 12 + dangerRisks * 7 + (totalRisks - criticalRisks - dangerRisks) * 3);
  const baseScore      = Math.round(adherencePct * 0.4 + moodScore * 0.25 + vitalStability * 0.25 + 10);
  const healthScore    = Math.max(10, Math.min(100, baseScore - riskPenalty));

  // Taken / missed / partial from adherence data
  const totalMedDays   = adherence?.medications.reduce((a, m) => a + m.days_due, 0)     || report?.medications.total || 0;
  const takenMedDays   = adherence?.medications.reduce((a, m) => a + m.days_taken, 0)   || report?.medications.taken || 0;
  const partialMedDays = adherence?.medications.reduce((a, m) => a + m.days_partial, 0) || 0;
  const missedMedDays  = adherence?.medications.reduce((a, m) => a + m.days_missed, 0)  ||
    Math.max(0, totalMedDays - takenMedDays - partialMedDays);

  const getMoodColor   = (m: string) => ({
    happy: '#00b894', neutral: '#74b9ff', sad: '#ff7675',
    anxious: '#fdcb6e', tired: '#a29bfe', lonely: '#fd79a8',
  }[m] || colors.textSecondary);

  const sev = (s: string) => s === 'critical'
    ? { bg: '#fff0f0', border: '#ff4757', text: '#ff4757', label: '🚨 Critical Alert' }
    : s === 'danger'
    ? { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ High Concern'   }
    : { bg: '#fffdf0', border: '#fdcb6e', text: '#856404', label: '⚠️ Watch'          };

  const getTrendLabel  = (t: string) =>
    t === 'rising' ? '↑ Going Up' : t === 'falling' ? '↓ Going Down' : '→ Stable';
  const getTrendColor  = (t: string) => t === 'rising' ? '#e17055' : t === 'falling' ? '#0984e3' : '#00b894';

  // Generate insight bullets
  const positives: Array<{ icon: string; text: string }> = [];
  const concerns:  Array<{ icon: string; text: string }> = [];
  const suggestions: Array<{ icon: string; text: string }> = [];

  if (adherencePct >= 90) positives.push({ icon: '💊', text: `Medication adherence is excellent at ${adherencePct}% — great consistency!` });
  else if (adherencePct >= 70) concerns.push({ icon: '💊', text: `Medication adherence is ${adherencePct}% — some doses were missed. Try setting more reminders.` });
  else concerns.push({ icon: '💊', text: `Medication adherence is low at ${adherencePct}%. ${missedMedDays} doses missed. This needs immediate attention.` });

  if (happyCount > 0 && happyCount >= negMoodCount) positives.push({ icon: '😊', text: `Emotional health is positive — happy moods recorded ${happyCount} time${happyCount !== 1 ? 's' : ''}.` });
  if (negMoodCount > 2) concerns.push({ icon: '😔', text: `Negative moods (sad/anxious/lonely) recorded ${negMoodCount} times. Consider scheduling more social activities.` });

  if (criticalRisks > 0) concerns.push({ icon: '🚨', text: `${criticalRisks} critical health alert${criticalRisks !== 1 ? 's' : ''} detected — please consult a doctor immediately.` });
  if (dangerRisks > 0)   concerns.push({ icon: '⚠️', text: `${dangerRisks} high-concern health pattern${dangerRisks !== 1 ? 's' : ''} found. Review with a healthcare provider soon.` });
  if (totalRisks === 0)  positives.push({ icon: '✅', text: 'No health alerts detected in this period — vital signs look stable.' });

  const risingNames = risingVitals.map(v => v.label).join(' and ');
  if (risingVitals.length > 0) concerns.push({ icon: '📈', text: `${risingNames} ${risingVitals.length > 1 ? 'are' : 'is'} trending upward. Monitor closely and consult a doctor if it continues.` });
  if (stableVitals > 0) positives.push({ icon: '📊', text: `${stableVitals} vital sign${stableVitals !== 1 ? 's' : ''} is tracking steadily — no sudden changes detected.` });

  const healthLogs  = report?.healthLogs.reduce((a, l) => a + l.count, 0) || 0;
  if (healthLogs > 0) positives.push({ icon: '🩺', text: `${healthLogs} health readings logged — good monitoring habit!` });
  else suggestions.push({ icon: '🩺', text: 'No health readings recorded this period. Try logging vitals daily for better tracking.' });

  if (adherence?.worst_med && adherence.worst_med.adherence_pct < 70)
    suggestions.push({ icon: '⏰', text: `"${adherence.worst_med.title}" has the lowest adherence (${adherence.worst_med.adherence_pct}%). Consider adjusting the reminder schedule.` });

  if (negMoodCount > 2) suggestions.push({ icon: '🌿', text: 'Consider scheduling regular video calls or visits to improve emotional well-being.' });
  suggestions.push({ icon: '📋', text: 'Share this report with the healthcare provider at the next visit.' });

  // ── Date picker modal ────────────────────────────────────────────────────────
  const renderDatePicker = () => {
    const months   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const yr       = new Date().getFullYear();
    const years    = [yr - 2, yr - 1, yr];
    const dayNums  = Array.from({ length: 31 }, (_, i) => i + 1);
    const parseISO = (iso: string) => { const d = new Date(iso); return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }; };
    const current  = parseISO(pickerTarget === 'start' ? startDate : endDate);
    const setDatePart = (part: 'year' | 'month' | 'day', val: number) => {
      const d = parseISO(pickerTarget === 'start' ? startDate : endDate);
      d[part] = val;
      const iso = toISO(new Date(d.year, d.month, Math.min(d.day, 28)));
      pickerTarget === 'start' ? setStartDate(iso) : setEndDate(iso);
    };
    return (
      <Modal visible={showPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Select {pickerTarget === 'start' ? 'Start' : 'End'} Date</Text>
            <View style={styles.pickerRow}>
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {months.map((m, i) => (
                  <TouchableOpacity key={m} onPress={() => setDatePart('month', i)}
                    style={[styles.pickerItem, current.month === i && styles.pickerItemActive]}>
                    <Text style={[styles.pickerItemText, current.month === i && styles.pickerItemActiveText]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {dayNums.map(d => (
                  <TouchableOpacity key={d} onPress={() => setDatePart('day', d)}
                    style={[styles.pickerItem, current.day === d && styles.pickerItemActive]}>
                    <Text style={[styles.pickerItemText, current.day === d && styles.pickerItemActiveText]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <ScrollView style={styles.pickerCol} showsVerticalScrollIndicator={false}>
                {years.map(y => (
                  <TouchableOpacity key={y} onPress={() => setDatePart('year', y)}
                    style={[styles.pickerItem, current.year === y && styles.pickerItemActive]}>
                    <Text style={[styles.pickerItemText, current.year === y && styles.pickerItemActiveText]}>{y}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity style={styles.modalDoneBtn} onPress={() => { setShowPicker(false); setPreset('custom'); }}>
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Date controls ─────────────────────────────────────────────────────────────
  const renderDateControls = () => {
    const { s, e } = computedRange();
    if (mode === 'daily') {
      return (
        <View style={styles.dateControls}>
          <TouchableOpacity style={styles.arrowBtn} onPress={() => setEndDate(toISO(addDays(new Date(endDate), -1)))}>
            <Text style={styles.arrowText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.datePill} onPress={() => { setPickerTarget('end'); setShowPicker(true); }}>
            <Text style={styles.datePillText}>{fmtFull(endDate)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.arrowBtn}
            onPress={() => { if (endDate < todayISO) setEndDate(toISO(addDays(new Date(endDate), 1))); }}>
            <Text style={styles.arrowText}>›</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (mode === 'yearly') {
      return (
        <View style={styles.dateControls}>
          <TouchableOpacity style={styles.arrowBtn} onPress={() => setSelectedYear(y => y - 1)}>
            <Text style={styles.arrowText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.datePill}><Text style={styles.datePillText}>{selectedYear}</Text></View>
          <TouchableOpacity style={styles.arrowBtn}
            onPress={() => { if (selectedYear < new Date().getFullYear()) setSelectedYear(y => y + 1); }}>
            <Text style={styles.arrowText}>›</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <>
        <View style={styles.presetRow}>
          {(['7','14','30'] as DatePreset[]).map(p => (
            <TouchableOpacity key={p} style={[styles.presetBtn, preset === p && styles.presetBtnActive]} onPress={() => applyPreset(p)}>
              <Text style={[styles.presetBtnText, preset === p && styles.presetBtnActiveText]}>{p}d</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.presetBtn, preset === 'custom' && styles.presetBtnActive]} onPress={() => applyPreset('custom')}>
            <Text style={[styles.presetBtnText, preset === 'custom' && styles.presetBtnActiveText]}>Custom</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.dateRangeRow}>
          <Text style={styles.weekOfLabel}>Period</Text>
          <TouchableOpacity style={styles.datePill} onPress={() => { setPickerTarget('start'); setShowPicker(true); setPreset('custom'); }}>
            <Text style={styles.datePillText}>{fmtShort(s)}</Text>
          </TouchableOpacity>
          <Text style={styles.dateSep}>→</Text>
          <TouchableOpacity style={styles.datePill} onPress={() => { setPickerTarget('end'); setShowPicker(true); setPreset('custom'); }}>
            <Text style={styles.datePillText}>{fmtShort(e)}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  // ── Render sections ────────────────────────────────────────────────────────────
  const renderSummary = () => (
    <>
      {/* Health Score */}
      <Text style={styles.sectionHead}>🏥 Overall Health Score</Text>
      <HealthScoreCard
        score={healthScore}
        adherencePct={adherencePct}
        criticalRisks={criticalRisks}
        moodScore={moodScore}
        vitalStability={vitalStability}
      />

      {/* Quick Stats Row */}
      <Text style={styles.sectionHead}>📌 At a Glance</Text>
      <View style={styles.statsGrid}>
        {[
          { icon: '💊', label: 'Meds Taken',  value: `${takenMedDays}/${totalMedDays}`, color: adherenceClr },
          { icon: '🩺', label: 'Readings',    value: `${healthLogs}`,                   color: '#6c5ce7'    },
          { icon: '😊', label: 'Mood Logs',   value: `${moodTotal}`,                    color: '#74b9ff'    },
          { icon: '⚠️', label: 'Alerts',      value: `${totalRisks}`,                   color: totalRisks > 0 ? '#e17055' : '#00b894' },
        ].map(s => (
          <View key={s.label} style={styles.statBox}>
            <Text style={{ fontSize: 22 }}>{s.icon}</Text>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* ── FIX 1: Medication Overview with collapsible per-med section ── */}
      <Text style={styles.sectionHead}>💊 Medication Overview</Text>
      <Card style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <DonutRing pct={adherencePct} size={76} color={adherenceClr} label={`${adherencePct}%`} />
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={[styles.bigStat, { color: adherenceClr }]}>{adherenceLabel}</Text>
            <Text style={styles.bigStatSub}>{takenMedDays} of {totalMedDays} doses taken</Text>
            {adherence?.worst_med && (
              <Text style={{ fontSize: 11, color: '#e17055', marginTop: 4 }}>
                ⚠️ Lowest: "{adherence.worst_med.title}" ({adherence.worst_med.adherence_pct}%)
              </Text>
            )}
          </View>
        </View>

        <MedStackBar taken={takenMedDays} partial={partialMedDays} missed={missedMedDays} total={totalMedDays} />

        {/* Collapsible per-medication breakdown */}
        {adherence?.medications && adherence.medications.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <TouchableOpacity
              style={styles.dropdownToggle}
              onPress={() => setMedBreakdownOpen(o => !o)}
              activeOpacity={0.75}
            >
              <Text style={styles.dropdownToggleLabel}>
                💊 Per Medication ({adherence.medications.length})
              </Text>
              <Text style={[styles.dropdownChevron, { transform: [{ rotate: medBreakdownOpen ? '90deg' : '0deg' }] }]}>›</Text>
            </TouchableOpacity>

            {medBreakdownOpen && (
              <View style={{ marginTop: 10 }}>
                {adherence.medications.map(med => (
                  <CollapsibleMedRow key={med.id} med={med} />
                ))}
              </View>
            )}
          </View>
        )}
      </Card>

      {/* ── FIX 3: Improved Vital Signs Snapshot ── */}
      {goodVitals.length > 0 && (
        <>
          <Text style={styles.sectionHead}>❤️ Vital Signs Snapshot</Text>
          <Text style={styles.sectionSubhead}>Tap any reading for full details in the Vitals tab</Text>
          {goodVitals.map(vital => (
            <VitalSnapshotCard key={vital.log_type} vital={vital} />
          ))}
        </>
      )}

      {/* Mood Snapshot */}
      {report && report.mood.length > 0 && (
        <>
          <Text style={styles.sectionHead}>😊 Emotional Well-being</Text>
          <Card style={styles.card}>
            <MoodDistribution moodData={report.mood} />
            <View style={[styles.summaryLine, { marginTop: 12 }]}>
              <Text style={styles.summaryKey}>Total check-ins:</Text>
              <Text style={styles.summaryVal}>{moodTotal}</Text>
            </View>
            {negMoodCount > 2 && (
              <View style={[styles.alertPill, { marginTop: 8 }]}>
                <Text style={styles.alertPillTxt}>
                  ⚠️ {negMoodCount} difficult mood days — consider increasing social interaction or speaking with a counselor.
                </Text>
              </View>
            )}
          </Card>
        </>
      )}

      {/* AI Health Insights */}
      {aiInsights.length > 0 && (
        <>
          <Text style={styles.sectionHead}>🔍 Health Pattern Insights</Text>
          <Card style={styles.card}>
            {aiInsights.map((insight, i) => (
              <InsightPill key={i} icon="🔔" text={insight} type="warn" />
            ))}
          </Card>
        </>
      )}

      {/* What Went Well */}
      {positives.length > 0 && (
        <>
          <Text style={styles.sectionHead}>✅ What Went Well</Text>
          <Card style={styles.card}>
            {positives.map((p, i) => (
              <InsightPill key={i} icon={p.icon} text={p.text} type="good" />
            ))}
          </Card>
        </>
      )}

      {/* Areas Needing Attention */}
      {concerns.length > 0 && (
        <>
          <Text style={styles.sectionHead}>⚠️ Areas Needing Attention</Text>
          <Card style={styles.card}>
            {concerns.map((c, i) => (
              <InsightPill key={i} icon={c.icon} text={c.text} type={c.icon === '🚨' ? 'bad' : 'warn'} />
            ))}
          </Card>
        </>
      )}

      {/* Recommendations */}
      <Text style={styles.sectionHead}>💡 Recommendations</Text>
      <Card style={styles.card}>
        {suggestions.map((s, i) => (
          <InsightPill key={i} icon={s.icon} text={s.text} type="info" />
        ))}
      </Card>

      {/* Risks summary */}
      {report && report.risks.length > 0 && (
        <>
          <Text style={styles.sectionHead}>🚨 Health Alerts ({report.risks.length})</Text>
          {report.risks.map((risk, i) => {
            const sv = sev(risk.severity);
            return (
              <View key={i} style={[styles.riskCard, { borderLeftColor: sv.border, backgroundColor: sv.bg }]}>
                <Text style={[styles.riskSeverity, { color: sv.text }]}>{sv.label}</Text>
                <Text style={styles.riskMsg}>{risk.message}</Text>
              </View>
            );
          })}
        </>
      )}
    </>
  );

  const renderMedications = () => (
    <>
      <Text style={styles.sectionHead}>💊 Medication Adherence</Text>
      <Card style={styles.card}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <DonutRing pct={adherencePct} size={110} color={adherenceClr} label={`${adherencePct}%`} sublabel="adherence" />
          <View style={[styles.badge, { backgroundColor: adherenceClr + '22', borderColor: adherenceClr, marginTop: 10 }]}>
            <Text style={[styles.badgeText, { color: adherenceClr }]}>{adherenceLabel}</Text>
          </View>
        </View>
        <MedStackBar taken={takenMedDays} partial={partialMedDays} missed={missedMedDays} total={totalMedDays} />
        <View style={styles.statsGrid3}>
          <View style={styles.statBox3}>
            <Text style={[styles.statValue3, { color: '#00b894' }]}>{takenMedDays}</Text>
            <Text style={styles.statLabel3}>Taken</Text>
          </View>
          {partialMedDays > 0 && (
            <View style={styles.statBox3}>
              <Text style={[styles.statValue3, { color: '#fdcb6e' }]}>{partialMedDays}</Text>
              <Text style={styles.statLabel3}>Partial</Text>
            </View>
          )}
          <View style={styles.statBox3}>
            <Text style={[styles.statValue3, { color: '#ff7675' }]}>{missedMedDays}</Text>
            <Text style={styles.statLabel3}>Missed</Text>
          </View>
          <View style={styles.statBox3}>
            <Text style={[styles.statValue3, { color: colors.primary }]}>{totalMedDays}</Text>
            <Text style={styles.statLabel3}>Total</Text>
          </View>
        </View>
      </Card>

      {adherence?.medications && adherence.medications.length > 0 && (
        <>
          <Text style={styles.sectionHead}>📋 Per Medication Breakdown</Text>
          <Text style={styles.sectionSubhead}>Tap each medication to see details</Text>
          {adherence.medications.map(med => (
            <CollapsibleMedRow key={med.id} med={med} />
          ))}
        </>
      )}

      {adherence?.worst_med && adherence.worst_med.adherence_pct < 80 && (
        <View style={[styles.riskCard, { borderLeftColor: '#e17055', backgroundColor: '#fff5f0', marginTop: 4 }]}>
          <Text style={[styles.riskSeverity, { color: '#e17055' }]}>💡 Tip</Text>
          <Text style={styles.riskMsg}>
            "{adherence.worst_med.title}" has the lowest adherence at {adherence.worst_med.adherence_pct}%
            ({adherence.worst_med.days_missed} missed out of {adherence.worst_med.days_due}).
            Consider adjusting the reminder schedule or checking for side effects.
          </Text>
        </View>
      )}
    </>
  );

  const renderVitals = () => (
    <>
      {!report?.healthLogs.length ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>🩺</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 }}>No readings this period</Text>
            <Text style={[styles.emptyText, { marginTop: 0 }]}>Try logging daily vitals for better trend tracking.</Text>
          </View>
        </Card>
      ) : (
        report.healthLogs.map(log => (
          <Card key={log.log_type} style={styles.card}>
            <View style={styles.vitalHeader}>
              <Text style={{ fontSize: 24, marginRight: 8 }}>{healthIcons[log.log_type] || '📊'}</Text>
              <Text style={styles.vitalLabel}>{log.log_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</Text>
              <View style={styles.vitalCountBadge}>
                <Text style={styles.vitalCountText}>{log.count} readings</Text>
              </View>
            </View>

            <VitalChart
              data={trends[log.log_type] || []}
              logType={log.log_type}
              unit={vitalUnits[log.log_type] || ''}
              themeColor={vitalColors[log.log_type]}
            />

            {/* Trend from analysis */}
            {(() => {
              const va = goodVitals.find(v => v.log_type === log.log_type);
              if (!va) return null;
              const tc = getTrendColor(va.regression.trend);
              const tl = getTrendLabel(va.regression.trend);
              const changeAbs = Math.abs(va.regression.change_per_week);
              return (
                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <View style={[styles.trendBadge, { backgroundColor: tc + '22', borderColor: tc }]}>
                      <Text style={[styles.trendBadgeTxt, { color: tc }]}>{tl}</Text>
                    </View>
                    {va.clinical_status && (
                      <View style={[styles.zoneBadge, { backgroundColor: va.clinical_status.color + '22' }]}>
                        <Text style={[styles.zoneBadgeTxt, { color: va.clinical_status.color }]}>{va.clinical_status.label}</Text>
                      </View>
                    )}
                  </View>
                  {changeAbs > 0 && va.regression.trend !== 'stable' && (
                    <Text style={{ fontSize: 12, color: tc, fontWeight: '600', marginBottom: 6 }}>
                      {va.regression.trend === 'rising' ? '↑ Increasing' : '↓ Decreasing'} by ~{changeAbs} {va.unit} per week
                    </Text>
                  )}
                </View>
              );
            })()}

            <View style={styles.vitalStats}>
              {log.avg_value != null && (
                <View style={styles.vitalStat}>
                  <Text style={styles.vitalStatLabel}>Avg</Text>
                  <Text style={styles.vitalStatVal}>{Number(log.avg_value).toFixed(1)}</Text>
                  <Text style={styles.vitalStatUnit}>{vitalUnits[log.log_type] || ''}</Text>
                </View>
              )}
              <View style={styles.vitalStat}>
                <Text style={styles.vitalStatLabel}>Min</Text>
                <Text style={[styles.vitalStatVal, { color: '#00b894' }]}>{log.min_value}</Text>
              </View>
              <View style={styles.vitalStat}>
                <Text style={styles.vitalStatLabel}>Max</Text>
                <Text style={[styles.vitalStatVal, { color: '#e17055' }]}>{log.max_value}</Text>
              </View>
              <View style={styles.vitalStat}>
                <Text style={styles.vitalStatLabel}>Count</Text>
                <Text style={[styles.vitalStatVal, { color: colors.primary }]}>{log.count}</Text>
              </View>
            </View>
          </Card>
        ))
      )}
    </>
  );

  const renderMood = () => (
    <>
      {!report?.mood.length ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>😶</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 }}>No mood logs yet</Text>
            <Text style={[styles.emptyText, { marginTop: 0 }]}>Encourage daily mood check-ins for better wellbeing tracking.</Text>
          </View>
        </Card>
      ) : (
        <>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>😊 Mood Distribution</Text>
            <MoodDistribution moodData={report.mood} />
            <View style={{ marginTop: 14 }}>
              {report.mood.map(item => {
                const total = report.mood.reduce((a, m) => a + m.count, 0);
                const pct   = Math.round((item.count / total) * 100);
                return (
                  <View key={item.mood} style={styles.moodRow}>
                    <Text style={styles.moodEmoji}>{moodEmojis[item.mood] || '😐'}</Text>
                    <Text style={styles.moodLabel}>{item.mood.charAt(0).toUpperCase() + item.mood.slice(1)}</Text>
                    <View style={styles.moodTrack}>
                      <View style={[styles.moodFill, { width: `${pct}%` as any, backgroundColor: getMoodColor(item.mood) }]} />
                    </View>
                    <Text style={styles.moodCount}>{item.count}×</Text>
                    <Text style={[styles.moodPct, { color: getMoodColor(item.mood) }]}>{pct}%</Text>
                  </View>
                );
              })}
            </View>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.cardTitle}>📊 Wellbeing Summary</Text>
            {(() => {
              const total = report.mood.reduce((a, m) => a + m.count, 0);
              const top   = report.mood.reduce((a, b) => a.count > b.count ? a : b);
              return (
                <View style={{ gap: 8 }}>
                  <View style={styles.wbRow}>
                    <Text style={styles.wbKey}>Most frequent mood:</Text>
                    <Text style={styles.wbVal}>{moodEmojis[top.mood]} {top.mood.charAt(0).toUpperCase() + top.mood.slice(1)}</Text>
                  </View>
                  <View style={styles.wbRow}>
                    <Text style={styles.wbKey}>Positive days:</Text>
                    <Text style={[styles.wbVal, { color: '#00b894' }]}>{happyCount + neutralCount} of {total}</Text>
                  </View>
                  {negMoodCount > 0 && (
                    <View style={styles.wbRow}>
                      <Text style={styles.wbKey}>Difficult days:</Text>
                      <Text style={[styles.wbVal, { color: '#e17055' }]}>{negMoodCount} of {total}</Text>
                    </View>
                  )}
                  <View style={styles.wbRow}>
                    <Text style={styles.wbKey}>Wellbeing score:</Text>
                    <Text style={[styles.wbVal, { color: moodScore >= 70 ? '#00b894' : '#e17055', fontWeight: '700' }]}>{moodScore}%</Text>
                  </View>
                  {negMoodCount > 2 && (
                    <View style={[styles.alertPill, { marginTop: 4 }]}>
                      <Text style={styles.alertPillTxt}>
                        💡 Consider scheduling more social activities or a check-in with a counselor.
                      </Text>
                    </View>
                  )}
                </View>
              );
            })()}
          </Card>
        </>
      )}
    </>
  );

  const renderRisks = () => (
    <>
      {/* AI Insights */}
      {aiInsights.length > 0 && (
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>🔍 Health Pattern Insights</Text>
          <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10, lineHeight: 17 }}>
            Based on the patterns in the health data, these observations may need attention:
          </Text>
          {aiInsights.map((insight, i) => (
            <InsightPill key={i} icon="⚠️" text={insight} type="warn" />
          ))}
        </Card>
      )}

      {!report?.risks.length ? (
        <Card style={{ alignItems: 'center', paddingVertical: 50 }}>
          <Text style={{ fontSize: 56, marginBottom: 14 }}>✅</Text>
          <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#00b894', marginBottom: 8 }}>No health alerts detected</Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
            All vital signs appear within normal ranges for this period.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>📊 Alert Summary</Text>
            <View style={styles.statsGrid3}>
              {[
                { label: 'Critical', count: criticalRisks, color: '#ff4757' },
                { label: 'High',     count: dangerRisks,   color: '#e17055' },
                { label: 'Warning',  count: totalRisks - criticalRisks - dangerRisks, color: '#fdcb6e' },
              ].map(r => (
                <View key={r.label} style={[styles.statBox3, { backgroundColor: r.color + '11' }]}>
                  <Text style={[styles.statValue3, { color: r.color }]}>{r.count}</Text>
                  <Text style={[styles.statLabel3, { color: r.color }]}>{r.label}</Text>
                </View>
              ))}
            </View>
          </Card>
          {report.risks.map((risk, i) => {
            const sv = sev(risk.severity);
            return (
              <View key={i} style={[styles.riskCard, { borderLeftColor: sv.border, backgroundColor: sv.bg, marginBottom: 12 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={[styles.riskSeverity, { color: sv.text }]}>{sv.label}</Text>
                  <Text style={{ fontSize: 11, color: colors.textSecondary }}>{new Date(risk.detected_at).toLocaleDateString()}</Text>
                </View>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 }}>
                  {risk.risk_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Text>
                <Text style={styles.riskMsg}>{risk.message}</Text>
              </View>
            );
          })}
        </>
      )}
    </>
  );

  const renderActivity = () => (
    <>
      {!report?.activity.length ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>📭</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 }}>No activity recorded</Text>
            <Text style={[styles.emptyText, { marginTop: 0 }]}>Activities will appear here once health data is logged.</Text>
          </View>
        </Card>
      ) : (
        <>
          <Text style={styles.sectionHead}>📅 Activity Log</Text>
          <Card style={styles.card}>
            {report.activity.map((item, i) => {
              const meta: Record<string, { icon: string; label: string; color: string }> = {
                health_log:        { icon: '📊', label: 'Health Reading',   color: '#00b894' },
                mood_log:          { icon: '😊', label: 'Mood Recorded',    color: '#74b9ff' },
                medication_taken:  { icon: '💊', label: 'Medication Taken', color: '#a29bfe' },
                medication_missed: { icon: '❌', label: 'Medication Missed',color: '#ff7675' },
              };
              const info = meta[item.activity_type] || { icon: '📌', label: item.activity_type, color: colors.textSecondary };
              return (
                <View key={i} style={styles.activityRow}>
                  <Text style={{ fontSize: 22, marginRight: 10 }}>{info.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>{info.label}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{new Date(item.day).toLocaleDateString()}</Text>
                  </View>
                  <View style={[styles.activityBadge, { backgroundColor: info.color }]}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>{item.count}×</Text>
                  </View>
                </View>
              );
            })}
          </Card>

          {/* Activity trends chart */}
          {report.activity.length > 1 && (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>📈 Activity by Type</Text>
              {Object.entries(
                report.activity.reduce<Record<string, number>>((acc, item) => {
                  acc[item.activity_type] = (acc[item.activity_type] || 0) + item.count;
                  return acc;
                }, {})
              ).map(([type, count]) => {
                const meta: Record<string, { label: string; color: string }> = {
                  health_log:       { label: 'Health Readings',   color: '#00b894' },
                  mood_log:         { label: 'Mood Check-ins',    color: '#74b9ff' },
                  medication_taken: { label: 'Medications Taken', color: '#a29bfe' },
                  medication_missed:{ label: 'Missed Doses',      color: '#ff7675' },
                };
                const info = meta[type] || { label: type, color: '#636e72' };
                const maxCount = Math.max(...Object.values(
                  report.activity.reduce<Record<string, number>>((acc, item) => {
                    acc[item.activity_type] = (acc[item.activity_type] || 0) + item.count;
                    return acc;
                  }, {})
                ));
                return (
                  <MiniBar key={type} value={count} max={maxCount} color={info.color} label={info.label} />
                );
              })}
            </Card>
          )}
        </>
      )}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle}>Health Report</Text>
          <Text style={styles.headerSub}>{elderName}</Text>
        </View>
        <TouchableOpacity style={styles.downloadBtn} onPress={downloadPDF} disabled={downloading || loading}>
          {downloading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.downloadBtnText}>⬇ PDF</Text>}
        </TouchableOpacity>
      </View>

      {/* Mode selector */}
      <View style={styles.modeRow}>
        {(['daily','weekly','yearly'] as ReportMode[]).map(m => (
          <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => { setMode(m); setActiveSection('summary'); }}>
            <Text style={[styles.modeBtnText, mode === m && styles.modeBtnActiveText]}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date controls */}
      <View style={styles.dateControlsWrap}>
        {renderDateControls()}
      </View>

      {/* Critical risk banner */}
      {!loading && (criticalRisks > 0 || dangerRisks > 0) && (
        <View style={[styles.riskBanner, { backgroundColor: criticalRisks > 0 ? '#ff4757' : '#e17055' }]}>
          <Text style={styles.riskBannerText}>
            {criticalRisks > 0
              ? `🚨 ${criticalRisks} critical alert${criticalRisks > 1 ? 's' : ''} — please consult a doctor immediately`
              : `⚠️ ${dangerRisks} high-concern pattern${dangerRisks > 1 ? 's' : ''} — review with healthcare provider`}
          </Text>
        </View>
      )}

      {/* Section tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sectionTabBar}>
        {SECTIONS.map(sc => (
          <TouchableOpacity key={sc.key}
            style={[styles.sectionTab, activeSection === sc.key && styles.sectionTabActive]}
            onPress={() => setActiveSection(sc.key)}>
            <Text style={[styles.sectionTabText, activeSection === sc.key && { color: '#fff' }]}>
              {sc.icon} {sc.key === 'risks' && report?.risks.length
                ? `Risks (${report.risks.length})`
                : sc.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Building your report...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
          <View style={{ paddingBottom: 40 }}>
            {activeSection === 'summary'     && renderSummary()}
            {activeSection === 'medications' && renderMedications()}
            {activeSection === 'vitals'      && renderVitals()}
            {activeSection === 'mood'        && renderMood()}
            {activeSection === 'risks'       && renderRisks()}
            {activeSection === 'activity'    && renderActivity()}
          </View>
        </ScrollView>
      )}

      {renderDatePicker()}
    </SafeAreaView>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: colors.background },
  header:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:             { padding: 4 },
  backIcon:            { fontSize: 20, color: colors.primary },
  headerMid:           { flex: 1, marginHorizontal: 12 },
  headerTitle:         { fontSize: 17, fontWeight: 'bold', color: colors.textPrimary },
  headerSub:           { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  downloadBtn:         { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  downloadBtnText:     { color: '#fff', fontSize: 12, fontWeight: '700' },
  modeRow:             { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  modeBtn:             { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  modeBtnActive:       { borderBottomColor: colors.primary },
  modeBtnText:         { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  modeBtnActiveText:   { color: colors.primary },
  dateControlsWrap:    { backgroundColor: colors.white, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  dateControls:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  arrowBtn:            { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  arrowText:           { fontSize: 22, color: colors.primary, lineHeight: 26 },
  datePill:            { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#e8f4ff', borderWidth: 1, borderColor: '#b3d8f5' },
  datePillText:        { fontSize: 13, color: colors.primary, fontWeight: '700' },
  presetRow:           { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  presetBtn:           { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  presetBtnActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  presetBtnText:       { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  presetBtnActiveText: { color: '#fff' },
  dateRangeRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekOfLabel:         { fontSize: 12, color: colors.textSecondary },
  dateSep:             { fontSize: 13, color: colors.textSecondary },
  riskBanner:          { padding: 12, alignItems: 'center' },
  riskBannerText:      { color: '#fff', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  sectionTabBar:       { backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 8, maxHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTab:          { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 7 },
  sectionTabActive:    { backgroundColor: colors.primary, borderColor: colors.primary },
  sectionTabText:      { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  loadingBox:          { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:         { marginTop: 12, color: colors.textSecondary, fontSize: 15 },
  body:                { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  card:                { marginBottom: 12 },
  sectionHead:         { fontSize: 14, fontWeight: '800', color: colors.textPrimary, marginBottom: 4, marginTop: 4 },
  sectionSubhead:      { fontSize: 11, color: colors.textSecondary, marginBottom: 8 },
  cardTitle:           { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 12 },
  emptyText:           { textAlign: 'center', color: colors.textSecondary, fontSize: 13, paddingVertical: 8, lineHeight: 19 },
  summaryLine:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryKey:          { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  summaryVal:          { fontSize: 13, color: colors.textSecondary },
  badge:               { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start' },
  badgeText:           { fontSize: 12, fontWeight: '600' },
  bigStat:             { fontSize: 20, fontWeight: '800', marginBottom: 2 },
  bigStatSub:          { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  miniHead:            { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, marginTop: 4 },
  statsGrid:           { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox:             { flex: 1, backgroundColor: colors.white, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  statValue:           { fontSize: 17, fontWeight: '800', marginTop: 4 },
  statLabel:           { fontSize: 10, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  statsGrid3:          { flexDirection: 'row', gap: 8, marginTop: 12 },
  statBox3:            { flex: 1, backgroundColor: colors.background, borderRadius: 10, padding: 10, alignItems: 'center' },
  statValue3:          { fontSize: 18, fontWeight: '800' },
  statLabel3:          { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  trendBadge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  trendBadgeTxt:       { fontSize: 11, fontWeight: '700' },
  zoneBadge:           { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  zoneBadgeTxt:        { fontSize: 10, fontWeight: '600' },
  vitalRow:            { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  vitalRowLabel:       { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  vitalRowSub:         { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  moodRow:             { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  moodEmoji:           { fontSize: 16, width: 26 },
  moodLabel:           { fontSize: 12, width: 62, color: colors.textPrimary, fontWeight: '500' },
  moodTrack:           { flex: 1, height: 7, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  moodFill:            { height: '100%', borderRadius: 4 },
  moodCount:           { fontSize: 11, color: colors.textSecondary, width: 22, textAlign: 'right' },
  moodPct:             { fontSize: 11, fontWeight: '700', width: 32, textAlign: 'right' },
  alertPill:           { backgroundColor: '#fff8e1', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#fdcb6e' },
  alertPillTxt:        { fontSize: 12, color: '#7d5a00', fontWeight: '600', lineHeight: 18 },
  wbRow:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wbKey:               { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  wbVal:               { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  riskCard:            { borderLeftWidth: 4, padding: 12, borderRadius: 10, marginBottom: 8 },
  riskSeverity:        { fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  riskMsg:             { fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
  vitalHeader:         { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  vitalLabel:          { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary, flex: 1 },
  vitalCountBadge:     { backgroundColor: '#e8f4ff', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  vitalCountText:      { fontSize: 11, color: colors.primary, fontWeight: '600' },
  vitalStats:          { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.background, borderRadius: 10, padding: 12, marginTop: 10 },
  vitalStat:           { alignItems: 'center' },
  vitalStatLabel:      { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  vitalStatVal:        { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary },
  vitalStatUnit:       { fontSize: 9, color: colors.textSecondary },
  medTitle:            { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  medTime:             { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  medPct:              { fontSize: 18, fontWeight: '800' },
  activityRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityBadge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },

  // Dropdown toggle for per-medication
  dropdownToggle:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#f7f9fc', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  dropdownToggleLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  dropdownChevron:     { fontSize: 20, color: colors.primary, fontWeight: '300' },

  // Modal
  modalOverlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:            { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 },
  modalTitle:          { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 16, textAlign: 'center' },
  pickerRow:           { flexDirection: 'row', height: 200, gap: 8 },
  pickerCol:           { flex: 1 },
  pickerItem:          { paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  pickerItemActive:    { backgroundColor: colors.primary },
  pickerItemText:      { fontSize: 14, color: colors.textPrimary },
  pickerItemActiveText:{ color: '#fff', fontWeight: 'bold' },
  modalDoneBtn:        { marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  modalDoneBtnText:    { fontSize: 15, fontWeight: 'bold', color: '#fff' },
});

export default ReportScreen;