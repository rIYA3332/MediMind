// components/MoodInsightsCard.tsx
// Caregiver-facing emotional well-being panel
// Usage: <MoodInsightsCard elderId={30} elderName="Manusha" />
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { getApiUrl } from '../config/api';
import { colors } from '../styles/colors';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MoodLog {
  id: number;
  mood: string;
  notes: string | null;
  sentiment_label: string | null;
  concern_score: number | string | null;   // MySQL DECIMAL arrives as string
  sentiment_color: string | null;
  logged_at: string;
}
interface Distribution { mood: string; count: number }
interface SentimentData {
  has_data: boolean;
  latest_mood: string;
  latest_sentiment: string | null;
  latest_score: number | string | null;    // MySQL DECIMAL arrives as string
  latest_color: string | null;
  latest_at: string;
  mood_streak: number;
  concerning_7d: number;
  distribution_7d: Distribution[];
  logs: MoodLog[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MOOD_EMOJIS: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢',
  anxious: '😰', tired: '😴', lonely: '🪑',
};
const SENTIMENT_META: Record<string, { color: string; emoji: string; bg: string }> = {
  POSITIVE:   { color: '#00b894', emoji: '😊', bg: '#f0fdf4' },
  NEUTRAL:    { color: '#74b9ff', emoji: '😐', bg: '#f0f6ff' },
  CONCERNING: { color: '#e67e22', emoji: '⚠️', bg: '#fffbf0' },
  CRITICAL:   { color: '#ff4757', emoji: '🚨', bg: '#fff5f5' },
};

// ─── Helper — safely convert MySQL DECIMAL string → number ───────────────────
const toNum = (v: any): number => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

function formatTimeAgo(iso: string) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Score Bar ────────────────────────────────────────────────────────────────
const ScoreBar: React.FC<{ score: number; color: string }> = ({ score, color }) => (
  <View style={bar.track}>
    <View style={[bar.fill, { width: `${score}%` as any, backgroundColor: color }]} />
    <View style={[bar.marker, { left: `${score}%` as any }]} />
  </View>
);
const bar = StyleSheet.create({
  track:  { height: 8, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginVertical: 6, position: 'relative' },
  fill:   { height: '100%', borderRadius: 4 },
  marker: { position: 'absolute', top: -2, width: 2, height: 12, backgroundColor: '#333', borderRadius: 1 },
});

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props { elderId: number; elderName?: string }

const MoodInsightsCard: React.FC<Props> = ({ elderId, elderName }) => {
  const [data,        setData]        = useState<SentimentData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [expanded,    setExpanded]    = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchData = useCallback(async () => {
    if (!elderId) return;
    setLoading(true);
    try {
      const res  = await fetch(getApiUrl(`/api/mood/sentiment/${elderId}`));
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.log('MoodInsightsCard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [elderId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <View style={s.card}>
        <View style={s.loadingRow}>
          <ActivityIndicator size="small" color="#a29bfe" />
          <Text style={s.loadingTxt}>Loading emotional well-being data…</Text>
        </View>
      </View>
    );
  }

  if (!data?.has_data) {
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>🧠 Emotional Well-being</Text>
        <Text style={s.noDataTxt}>
          No mood check-ins recorded yet.{'\n'}
          Encourage {elderName || 'the elder'} to use the mood check-in feature.
        </Text>
      </View>
    );
  }

  const sentMeta   = SENTIMENT_META[data.latest_sentiment || ''] || SENTIMENT_META['NEUTRAL'];
  // ✅ FIX: parse DECIMAL string from MySQL before calling .toFixed()
  const score      = toNum(data.latest_score);
  const isCritical = data.latest_sentiment === 'CRITICAL';
  const isConcern  = data.latest_sentiment === 'CONCERNING';

  return (
    <View style={[s.card, isCritical && s.cardCritical, isConcern && s.cardConcerning]}>

      {/* ── Critical / Concerning Banner ───────────────────────────────── */}
      {(isCritical || isConcern) && (
        <View style={[s.urgentBanner, { backgroundColor: sentMeta.color }]}>
          <Text style={s.urgentTxt}>
            {sentMeta.emoji} {isCritical ? 'CRITICAL' : 'CONCERNING'} — Immediate attention may be needed
          </Text>
        </View>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <TouchableOpacity style={s.header} onPress={() => setExpanded(e => !e)} activeOpacity={0.8}>
        <Text style={s.cardTitle}>🧠 Emotional Well-being</Text>
        <Text style={s.expandHint}>{expanded ? '▲ Less' : '▼ Details'}</Text>
      </TouchableOpacity>

      {/* ── Latest Entry ───────────────────────────────────────────────── */}
      <View style={[s.latestBox, { backgroundColor: sentMeta.bg, borderColor: sentMeta.color }]}>
        <View style={s.latestRow}>
          <Text style={s.latestEmoji}>{sentMeta.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.latestLabel, { color: sentMeta.color }]}>
              {data.latest_sentiment || 'Unknown'}
            </Text>
            <Text style={s.latestMood}>
              {MOOD_EMOJIS[data.latest_mood]} {data.latest_mood.charAt(0).toUpperCase() + data.latest_mood.slice(1)}
              {'  ·  '}{formatTimeAgo(data.latest_at)}
            </Text>
          </View>
          <View style={s.scoreBox}>
            {/* ✅ FIX: score is now always a number */}
            <Text style={[s.scoreBig, { color: sentMeta.color }]}>{score.toFixed(0)}</Text>
            <Text style={s.scoreUnit}>/100</Text>
          </View>
        </View>
        <ScoreBar score={score} color={sentMeta.color} />
        <View style={s.scoreScale}>
          <Text style={s.scaleItem}>0 Positive</Text>
          <Text style={s.scaleItem}>50 Neutral</Text>
          <Text style={s.scaleItem}>100 Critical</Text>
        </View>
      </View>

      {/* ── Summary Stats ──────────────────────────────────────────────── */}
      <View style={s.statsRow}>
        <View style={s.statCell}>
          <Text style={[s.statVal, data.mood_streak >= 3 && { color: '#e17055' }]}>
            {data.mood_streak}
          </Text>
          <Text style={s.statLbl}>Streak</Text>
          <Text style={s.statSub}>days</Text>
        </View>
        <View style={s.statDiv} />
        <View style={s.statCell}>
          <Text style={[s.statVal, data.concerning_7d >= 3 && { color: '#e17055' }]}>
            {data.concerning_7d}
          </Text>
          <Text style={s.statLbl}>Concerning</Text>
          <Text style={s.statSub}>last 7 days</Text>
        </View>
        <View style={s.statDiv} />
        <View style={s.statCell}>
          <Text style={s.statVal}>{data.logs.length}</Text>
          <Text style={s.statLbl}>Check-ins</Text>
          <Text style={s.statSub}>recent</Text>
        </View>
      </View>

      {/* ── Streak Warning ─────────────────────────────────────────────── */}
      {data.mood_streak >= 3 && (
        <View style={s.streakWarning}>
          <Text style={s.streakTxt}>
            ⚠️ {data.mood_streak} consecutive concerning mood{data.mood_streak > 1 ? 's' : ''} detected.
            Consider reaching out today.
          </Text>
        </View>
      )}

      {/* ── Expanded Content ───────────────────────────────────────────── */}
      {expanded && (
        <View style={s.expandedBlock}>

          {/* 7-Day Distribution */}
          {data.distribution_7d.length > 0 && (
            <>
              <Text style={s.secTitle}>📊 7-Day Mood Distribution</Text>
              {data.distribution_7d.map(d => {
                const total = data.distribution_7d.reduce((a, x) => a + x.count, 0);
                const pct   = Math.round((d.count / total) * 100);
                return (
                  <View key={d.mood} style={s.distRow}>
                    <Text style={s.distEmoji}>{MOOD_EMOJIS[d.mood] || '😐'}</Text>
                    <Text style={s.distLabel}>
                      {d.mood.charAt(0).toUpperCase() + d.mood.slice(1)}
                    </Text>
                    <View style={s.distTrack}>
                      <View style={[s.distFill, {
                        width: `${pct}%` as any,
                        backgroundColor: ['sad','anxious','lonely'].includes(d.mood)
                          ? '#e17055' : '#00b894',
                      }]} />
                    </View>
                    <Text style={s.distCount}>{d.count}×</Text>
                  </View>
                );
              })}
            </>
          )}

          {/* Caregiver Advice */}
          {data.latest_sentiment && (
            <View style={[s.adviceBox, { borderLeftColor: sentMeta.color }]}>
              <Text style={s.adviceTitle}>💡 Caregiver Advice</Text>
              <Text style={s.adviceTxt}>
                {data.latest_sentiment === 'POSITIVE'
                  ? "Keep up the positive routines. Encourage the elder to share what made today good."
                  : data.latest_sentiment === 'NEUTRAL'
                  ? "Mood is neutral. Consider a short check-in call today. Light social interaction helps."
                  : data.latest_sentiment === 'CONCERNING'
                  ? `Signs of emotional distress. A phone call or visit today would help ${elderName || 'the elder'} greatly. If this continues 3+ days, consult a healthcare professional.`
                  : `URGENT: ${elderName || 'The elder'} may be experiencing severe distress. Immediate contact is strongly advised. Do not delay reaching out.`}
              </Text>
            </View>
          )}

          {/* Recent Log Toggle */}
          <TouchableOpacity
            style={s.historyToggle}
            onPress={() => setShowHistory(h => !h)}
          >
            <Text style={s.historyToggleTxt}>
              {showHistory ? '▲ Hide log' : `▼ Show last ${data.logs.length} check-ins`}
            </Text>
          </TouchableOpacity>

          {showHistory && data.logs.map((log, i) => {
            const sm = SENTIMENT_META[log.sentiment_label || ''];
            // ✅ FIX: parse each log's concern_score (also a DECIMAL string from MySQL)
            const logScore = toNum(log.concern_score);
            return (
              <View key={log.id} style={[
                s.logRow,
                i < data.logs.length - 1 && s.logBorder,
              ]}>
                <Text style={s.logEmoji}>{MOOD_EMOJIS[log.mood] || '😐'}</Text>
                <View style={s.logInfo}>
                  <Text style={s.logMood}>
                    {log.mood.charAt(0).toUpperCase() + log.mood.slice(1)}
                  </Text>
                  {log.notes ? (
                    <Text style={s.logNotes} numberOfLines={2}>"{log.notes}"</Text>
                  ) : null}
                  <Text style={s.logTime}>{formatTimeAgo(log.logged_at)}</Text>
                </View>
                {log.sentiment_label && sm && (
                  <View style={[s.sentBadge, { borderColor: sm.color, backgroundColor: sm.bg }]}>
                    <Text style={[s.sentTxt, { color: sm.color }]}>
                      {sm.emoji} {log.sentiment_label}
                    </Text>
                    {log.concern_score != null && (
                      <Text style={[s.sentScore, { color: sm.color }]}>
                        {/* ✅ FIX: use parsed number */}
                        {logScore.toFixed(0)}/100
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Refresh */}
          <TouchableOpacity style={s.refreshBtn} onPress={fetchData}>
            <Text style={s.refreshTxt}>↻ Refresh</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    backgroundColor: colors.white, borderRadius: 16, marginBottom: 14,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    overflow: 'hidden',
  },
  cardCritical:  { borderColor: '#ffcccc', borderWidth: 2 },
  cardConcerning:{ borderColor: '#ffe08a', borderWidth: 2 },

  urgentBanner:  { padding: 10, alignItems: 'center' },
  urgentTxt:     { color: '#fff', fontWeight: '800', fontSize: 13 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 16, paddingBottom: 8,
  },
  cardTitle:     { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  expandHint:    { fontSize: 11, color: colors.textSecondary },

  loadingRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  loadingTxt:    { fontSize: 13, color: colors.textSecondary },
  noDataTxt:     { fontSize: 13, color: colors.textSecondary, padding: 16, lineHeight: 20 },

  latestBox:     { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1.5, padding: 14 },
  latestRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  latestEmoji:   { fontSize: 32 },
  latestLabel:   { fontSize: 15, fontWeight: '800' },
  latestMood:    { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  scoreBox:      { alignItems: 'center', minWidth: 48 },
  scoreBig:      { fontSize: 26, fontWeight: '900', lineHeight: 28 },
  scoreUnit:     { fontSize: 10, color: colors.textSecondary },
  scoreScale:    { flexDirection: 'row', justifyContent: 'space-between' },
  scaleItem:     { fontSize: 9, color: colors.textSecondary },

  statsRow:      { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.background, borderRadius: 12, paddingVertical: 12 },
  statCell:      { flex: 1, alignItems: 'center' },
  statVal:       { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  statLbl:       { fontSize: 10, color: colors.textSecondary, marginTop: 2, fontWeight: '600' },
  statSub:       { fontSize: 9, color: colors.textSecondary },
  statDiv:       { width: 1, backgroundColor: colors.border },

  streakWarning: { marginHorizontal: 16, marginBottom: 10, backgroundColor: '#fff3e0', borderRadius: 10, padding: 10, borderLeftWidth: 4, borderLeftColor: '#e17055' },
  streakTxt:     { fontSize: 12, color: '#e17055', fontWeight: '600', lineHeight: 18 },

  expandedBlock: { borderTopWidth: 1, borderTopColor: colors.border, padding: 16, paddingTop: 12 },

  secTitle:      { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 10, textTransform: 'uppercase' },

  distRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  distEmoji:     { fontSize: 18, width: 24 },
  distLabel:     { fontSize: 12, fontWeight: '500', color: colors.textPrimary, width: 62 },
  distTrack:     { flex: 1, height: 7, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden' },
  distFill:      { height: '100%', borderRadius: 4 },
  distCount:     { fontSize: 11, color: colors.textSecondary, width: 24, textAlign: 'right' },

  adviceBox:     { borderLeftWidth: 4, borderRadius: 10, backgroundColor: '#f8f9ff', padding: 12, marginTop: 12, marginBottom: 4 },
  adviceTitle:   { fontSize: 12, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  adviceTxt:     { fontSize: 13, color: colors.textPrimary, lineHeight: 20 },

  historyToggle: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  historyToggleTxt: { fontSize: 13, color: colors.primary, fontWeight: '600' },

  logRow:        { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, gap: 10 },
  logBorder:     { borderBottomWidth: 1, borderBottomColor: colors.border },
  logEmoji:      { fontSize: 24, marginTop: 2 },
  logInfo:       { flex: 1 },
  logMood:       { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  logNotes:      { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic', lineHeight: 17 },
  logTime:       { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
  sentBadge:     { borderWidth: 1.5, borderRadius: 10, padding: 6, alignItems: 'center', minWidth: 70 },
  sentTxt:       { fontSize: 10, fontWeight: '700' },
  sentScore:     { fontSize: 10, fontWeight: '600', marginTop: 2 },

  refreshBtn:    { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  refreshTxt:    { fontSize: 13, color: colors.primary, fontWeight: '600' },
});

export default MoodInsightsCard;