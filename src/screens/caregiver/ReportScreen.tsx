// ReportScreen.tsx
// Supports Daily, Weekly, and Yearly reports with date filtering + Download PDF

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl, Modal, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Report {
  medications: { total: number; taken: number };
  healthLogs:  Array<{ log_type: string; count: number; avg_value: number; max_value: string; min_value: string }>;
  mood:        Array<{ mood: string; count: number }>;
  alerts:      { alert_count: number };
  risks:       Array<{ risk_type: string; severity: string; message: string; detected_at: string }>;
  activity:    Array<{ activity_type: string; count: number; day: string }>;
  dateRange?:  { startDate: string; endDate: string; days: number };
}

type ReportMode   = 'daily' | 'weekly' | 'yearly';
type DatePreset   = '7' | '14' | '30' | 'custom';
type Section      = 'overview' | 'health' | 'mood' | 'risks' | 'activity';

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
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'health',   label: 'Health'   },
  { key: 'mood',     label: 'Mood'     },
  { key: 'risks',    label: 'Risks'    },
  { key: 'activity', label: 'Activity' },
];

// ── Component ──────────────────────────────────────────────────────────────────
const ReportScreen = ({ route, navigation }: any) => {
  const { elderId, elderName } = route.params || {};

  // Report mode
  const [mode, setMode]           = useState<ReportMode>('weekly');

  // Date state
  const todayISO = toISO(new Date());
  const [startDate, setStartDate] = useState(() => toISO(addDays(new Date(), -6)));
  const [endDate, setEndDate]     = useState(todayISO);
  const [preset, setPreset]       = useState<DatePreset>('7');
  const [selectedYear, setSelectedYear]   = useState(new Date().getFullYear());
  const [showPicker, setShowPicker]       = useState(false);
  const [pickerTarget, setPickerTarget]   = useState<'start' | 'end'>('start');

  // Data
  const [report, setReport]       = useState<Report | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('overview');

  // ── Compute date range from mode ────────────────────────────────────────────
  const computedRange = useCallback((): { s: string; e: string } => {
    if (mode === 'daily') {
      return { s: endDate, e: endDate }; // single day
    }
    if (mode === 'yearly') {
      return { s: startOfYear(selectedYear), e: endOfYear(selectedYear) };
    }
    // weekly / custom
    return { s: startDate, e: endDate };
  }, [mode, startDate, endDate, selectedYear]);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchReport = useCallback(async () => {
    if (!elderId) return;
    setLoading(true);
    const { s, e } = computedRange();
    try {
      const res  = await fetch(getApiUrl(`/api/reports/weekly/${elderId}?startDate=${s}&endDate=${e}`));
      const data = await res.json();
      setReport(data);
    } catch (err) { console.log('Report fetch error:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [elderId, computedRange]);

  useEffect(() => { fetchReport(); }, [mode, startDate, endDate, selectedYear]);

  const onRefresh = () => { setRefreshing(true); fetchReport(); };

  // ── Apply preset (weekly mode) ───────────────────────────────────────────────
  const applyPreset = (p: DatePreset) => {
    if (p === 'custom') { setPreset('custom'); return; }
    setPreset(p);
    const days  = parseInt(p);
    const end   = new Date();
    const start = addDays(end, -(days - 1));
    setStartDate(toISO(start));
    setEndDate(toISO(end));
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

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const adherencePct  = !report || !report.medications.total ? 0
    : Math.round((report.medications.taken / report.medications.total) * 100);
  const adherenceClr  = adherencePct >= 90 ? '#00b894' : adherencePct >= 70 ? '#fdcb6e' : '#ff7675';
  const adherenceLabel = adherencePct >= 90 ? 'Excellent' : adherencePct >= 70 ? 'Good' : 'Needs Improvement';
  const getHealthLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const getMoodColor   = (m: string) => ({
    happy: '#00b894', neutral: '#74b9ff', sad: '#ff7675', anxious: '#fdcb6e', tired: '#a29bfe', lonely: '#fd79a8',
  }[m] || colors.textSecondary);
  const criticalRisks = report?.risks.filter(r => r.severity === 'critical').length || 0;
  const dangerRisks   = report?.risks.filter(r => r.severity === 'danger').length   || 0;

  const getUnit = (type: string) => ({
    blood_pressure: 'mmHg', blood_sugar: 'mg/dL', heart_rate: 'bpm', temperature: '°F', weight: 'kg',
  }[type] || '');

  // ── Date picker modal ────────────────────────────────────────────────────────
  const renderDatePicker = () => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const yr     = new Date().getFullYear();
    const years  = [yr - 2, yr - 1, yr];
    const days   = Array.from({ length: 31 }, (_, i) => i + 1);
    const parseISO = (iso: string) => { const d = new Date(iso); return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }; };
    const current  = parseISO(pickerTarget === 'start' ? startDate : endDate);
    const setDatePart = (part: 'year' | 'month' | 'day', val: number) => {
      const d   = parseISO(pickerTarget === 'start' ? startDate : endDate);
      d[part]   = val;
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
                {days.map(d => (
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

  // ── Date controls (changes based on mode) ────────────────────────────────────
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
          <View style={styles.datePill}>
            <Text style={styles.datePillText}>{selectedYear}</Text>
          </View>
          <TouchableOpacity style={styles.arrowBtn}
            onPress={() => { if (selectedYear < new Date().getFullYear()) setSelectedYear(y => y + 1); }}>
            <Text style={styles.arrowText}>›</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Weekly / custom
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
          <Text style={styles.weekOfLabel}>Week of</Text>
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

  // ── Severity card style ───────────────────────────────────────────────────────
  const sev = (s: string) => s === 'critical'
    ? { bg: '#fff0f0', border: '#ff4757', text: '#ff4757', label: '🚨 CRITICAL' }
    : s === 'danger'
    ? { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ DANGER'   }
    : { bg: '#fffdf0', border: '#fdcb6e', text: '#856404', label: '⚠️ WARNING'  };

  // ── Render ────────────────────────────────────────────────────────────────────
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

      {/* Mode selector: Daily / Weekly / Yearly */}
      <View style={styles.modeRow}>
        {(['daily','weekly','yearly'] as ReportMode[]).map(m => (
          <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => { setMode(m); setActiveSection('overview'); }}>
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
        <View style={[styles.riskBanner, criticalRisks > 0 ? { backgroundColor: '#ff4757' } : { backgroundColor: '#e17055' }]}>
          <Text style={styles.riskBannerText}>
            {criticalRisks > 0
              ? `🚨 ${criticalRisks} CRITICAL risk${criticalRisks > 1 ? 's' : ''} — immediate attention needed`
              : `⚠️ ${dangerRisks} HIGH risk${dangerRisks > 1 ? 's' : ''} — please review`}
          </Text>
        </View>
      )}

      {/* Section tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sectionTabBar}>
        {SECTIONS.map(sc => (
          <TouchableOpacity key={sc.key} style={[styles.sectionTab, activeSection === sc.key && styles.sectionTabActive]}
            onPress={() => setActiveSection(sc.key)}>
            <Text style={[styles.sectionTabText, activeSection === sc.key && { color: '#fff' }]}>
              {sc.key === 'risks' && report?.risks.length ? `Risks (${report.risks.length})` : sc.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Generating report...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          {/* ── OVERVIEW ── */}
          {activeSection === 'overview' && (
            <>
              {/* Summary card */}
              <Card style={styles.card}>
                <Text style={styles.cardTitle}>📝 Summary</Text>
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryKey}>Medication Adherence:</Text>
                  <Text style={[styles.summaryVal, { color: adherenceClr }]}>{adherencePct}%</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: adherenceClr + '22', borderColor: adherenceClr }]}>
                  <Text style={[styles.badgeText, { color: adherenceClr }]}>{adherenceLabel}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${adherencePct}%` as any, backgroundColor: adherenceClr }]} />
                </View>

                <View style={[styles.summaryLine, { marginTop: 10 }]}>
                  <Text style={styles.summaryKey}>Health Monitoring:</Text>
                  <Text style={styles.summaryVal}>{report?.healthLogs.reduce((a, l) => a + l.count, 0) || 0} entries</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: '#d4faf022', borderColor: '#00b894' }]}>
                  <Text style={[styles.badgeText, { color: '#00b894' }]}>
                    {(report?.healthLogs.reduce((a, l) => a + l.count, 0) || 0) > 0 ? 'Regular' : 'Low'}
                  </Text>
                </View>

                <View style={[styles.summaryLine, { marginTop: 10 }]}>
                  <Text style={styles.summaryKey}>Mood Tracking:</Text>
                  <Text style={styles.summaryVal}>{report?.mood.reduce((a, m) => a + m.count, 0) || 0} check-ins</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: '#d4faf022', borderColor: '#00b894' }]}>
                  <Text style={[styles.badgeText, { color: '#00b894' }]}>
                    {(report?.mood.reduce((a, m) => a + m.count, 0) || 0) >= (mode === 'daily' ? 1 : mode === 'yearly' ? 200 : 5) ? 'Good' : 'Fair'}
                  </Text>
                </View>

                <View style={[styles.summaryLine, { marginTop: 10 }]}>
                  <Text style={styles.summaryKey}>Alerts:</Text>
                  <Text style={styles.summaryVal}>{report?.alerts.alert_count || 0} in this period</Text>
                </View>
              </Card>

              {/* Vital trend cards */}
              {report?.healthLogs.map(log => (
                <View key={log.log_type} style={styles.trendSection}>
                  <Text style={styles.trendTitle}>{getHealthLabel(log.log_type)} Trends</Text>
                  <View style={styles.chartBox}>
                    <Text style={styles.chartBoxText}>{mode === 'daily' ? 'Today\'s' : mode === 'yearly' ? 'Yearly' : 'Weekly'} {getHealthLabel(log.log_type)} Chart</Text>
                  </View>
                  {log.avg_value != null && (
                    <Text style={styles.chartAvg}>Average: {Number(log.avg_value).toFixed(1)} {getUnit(log.log_type)}</Text>
                  )}
                  <View style={styles.minMaxRow}>
                    <Text style={styles.minMaxItem}>Min: <Text style={{ color: '#00b894', fontWeight: '700' }}>{log.min_value}</Text></Text>
                    <Text style={styles.minMaxItem}>Max: <Text style={{ color: '#e17055', fontWeight: '700' }}>{log.max_value}</Text></Text>
                    <Text style={styles.minMaxItem}>Logs: <Text style={{ color: colors.primary, fontWeight: '700' }}>{log.count}</Text></Text>
                  </View>
                </View>
              ))}

              {/* Emotional Well-being */}
              {report && report.mood.length > 0 && (() => {
                const top  = report.mood.reduce((a, b) => a.count > b.count ? a : b);
                const sad  = report.mood.filter(m => ['sad','lonely','anxious'].includes(m.mood)).reduce((a, m) => a + m.count, 0);
                const happy = report.mood.filter(m => m.mood === 'happy').reduce((a, m) => a + m.count, 0);
                return (
                  <View style={styles.trendSection}>
                    <Text style={styles.trendTitle}>Emotional Well-being</Text>
                    <View style={styles.wellbeingCard}>
                      <View style={styles.wbRow}><Text style={styles.wbKey}>Predominant Mood:</Text><Text style={styles.wbVal}>{top.mood.charAt(0).toUpperCase() + top.mood.slice(1)}</Text></View>
                      <View style={styles.wbRow}><Text style={styles.wbKey}>Days Happy:</Text><Text style={styles.wbVal}>{happy}</Text></View>
                      {sad > 0 && <View style={styles.wbRow}><Text style={styles.wbKey}>Days Sad/Lonely:</Text><Text style={[styles.wbVal, { color: '#e17055' }]}>{sad}</Text></View>}
                      {sad > 2 && <Text style={styles.wbNote}>Note: Consider increasing social interaction</Text>}
                      <View style={{ marginTop: 10 }}>
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
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })()}

              {/* Risks summary */}
              {report && report.risks.length === 0
                ? <View style={styles.noRisksRow}><Text style={styles.noRisksText}>✅ No health risks detected</Text></View>
                : report && (
                  <View style={styles.trendSection}>
                    <Text style={styles.trendTitle}>⚠️ Health Risks ({report.risks.length})</Text>
                    {report.risks.slice(0, 3).map((risk, i) => {
                      const s = sev(risk.severity);
                      return (
                        <View key={i} style={[styles.riskCard, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                          <Text style={[styles.riskSeverity, { color: s.text }]}>{s.label}</Text>
                          <Text style={styles.riskMsg}>{risk.message}</Text>
                        </View>
                      );
                    })}
                    {report.risks.length > 3 && (
                      <TouchableOpacity onPress={() => setActiveSection('risks')}>
                        <Text style={styles.viewAllLink}>View all {report.risks.length} risks →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
            </>
          )}

          {/* ── HEALTH ── */}
          {activeSection === 'health' && (
            !report?.healthLogs.length
              ? <Card><Text style={styles.emptyText}>No health logs in this period</Text></Card>
              : report.healthLogs.map(log => (
                <Card key={log.log_type} style={styles.card}>
                  <View style={styles.vitalHeader}>
                    <Text style={{ fontSize: 24, marginRight: 8 }}>{healthIcons[log.log_type] || '📊'}</Text>
                    <Text style={styles.vitalLabel}>{getHealthLabel(log.log_type)}</Text>
                    <View style={styles.vitalCountBadge}><Text style={styles.vitalCountText}>{log.count} logs</Text></View>
                  </View>
                  <View style={styles.vitalStats}>
                    {log.avg_value != null && (
                      <View style={styles.vitalStat}><Text style={styles.vitalStatLabel}>Avg</Text><Text style={styles.vitalStatVal}>{Number(log.avg_value).toFixed(1)}</Text></View>
                    )}
                    <View style={styles.vitalStat}><Text style={styles.vitalStatLabel}>Min</Text><Text style={[styles.vitalStatVal, { color: '#00b894' }]}>{log.min_value}</Text></View>
                    <View style={styles.vitalStat}><Text style={styles.vitalStatLabel}>Max</Text><Text style={[styles.vitalStatVal, { color: '#e17055' }]}>{log.max_value}</Text></View>
                  </View>
                </Card>
              ))
          )}

          {/* ── MOOD ── */}
          {activeSection === 'mood' && (
            !report?.mood.length
              ? <Card><Text style={styles.emptyText}>No mood data in this period</Text></Card>
              : (
                <Card style={styles.card}>
                  <Text style={styles.cardTitle}>😊 Mood Distribution</Text>
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
                      </View>
                    );
                  })}
                </Card>
              )
          )}

          {/* ── RISKS ── */}
          {activeSection === 'risks' && (
            !report?.risks.length
              ? (
                <Card style={{ alignItems: 'center', paddingVertical: 50 }}>
                  <Text style={{ fontSize: 56, marginBottom: 14 }}>✅</Text>
                  <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#00b894', marginBottom: 8 }}>No health risks detected</Text>
                  <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>All vital signs within normal ranges.</Text>
                </Card>
              )
              : report.risks.map((risk, i) => {
                const s = sev(risk.severity);
                return (
                  <View key={i} style={[styles.riskCard, styles.riskCardFull, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={[styles.riskSeverity, { color: s.text }]}>{s.label}</Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>{new Date(risk.detected_at).toLocaleDateString()}</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 }}>
                      {risk.risk_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Text>
                    <Text style={styles.riskMsg}>{risk.message}</Text>
                  </View>
                );
              })
          )}

          {/* ── ACTIVITY ── */}
          {activeSection === 'activity' && (
            !report?.activity.length
              ? <Card><Text style={styles.emptyText}>No activity in this period</Text></Card>
              : (
                <Card style={styles.card}>
                  <Text style={styles.cardTitle}>📅 Activity Log</Text>
                  {report.activity.map((item, i) => {
                    const meta: Record<string, { icon: string; label: string; color: string }> = {
                      health_log:        { icon: '📊', label: 'Health Logged',    color: '#00b894' },
                      mood_log:          { icon: '😊', label: 'Mood Recorded',     color: '#74b9ff' },
                      medication_taken:  { icon: '💊', label: 'Medication Taken',  color: '#a29bfe' },
                      medication_missed: { icon: '⚠️', label: 'Medication Missed', color: '#ff7675' },
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
              )
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {renderDatePicker()}
    </SafeAreaView>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.background },

  // Header
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:    { padding: 4 },
  backIcon:   { fontSize: 20, color: colors.primary },
  headerMid:  { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: colors.textPrimary },
  headerSub:  { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  downloadBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  downloadBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Mode selector
  modeRow:    { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  modeBtn:    { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  modeBtnActive: { borderBottomColor: colors.primary },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  modeBtnActiveText: { color: colors.primary },

  // Date controls
  dateControlsWrap: { backgroundColor: colors.white, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  dateControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  arrowBtn:   { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  arrowText:  { fontSize: 22, color: colors.primary, lineHeight: 26 },
  datePill:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#e8f4ff', borderWidth: 1, borderColor: '#b3d8f5' },
  datePillText: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  presetRow:  { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  presetBtn:  { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  presetBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetBtnText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  presetBtnActiveText: { color: '#fff' },
  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekOfLabel: { fontSize: 12, color: colors.textSecondary },
  dateSep:    { fontSize: 13, color: colors.textSecondary },

  // Risk banner
  riskBanner: { padding: 12, alignItems: 'center' },
  riskBannerText: { color: '#fff', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },

  // Section tabs
  sectionTabBar: { backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 8, maxHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  sectionTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sectionTabText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: colors.textSecondary, fontSize: 15 },

  body:       { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  card:       { marginBottom: 14 },
  cardTitle:  { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 12 },
  emptyText:  { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },

  // Summary
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryKey: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  summaryVal: { fontSize: 13, color: colors.textSecondary },
  badge:      { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start', marginBottom: 2 },
  badgeText:  { fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 8, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  progressFill:  { height: '100%', borderRadius: 4 },

  // Trends
  trendSection: { marginBottom: 18 },
  trendTitle:   { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  chartBox:     { height: 100, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fafafa', marginBottom: 8 },
  chartBoxText: { fontSize: 13, color: '#bbb' },
  chartAvg:     { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: 6 },
  minMaxRow:    { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.white, borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  minMaxItem:   { fontSize: 12, color: colors.textSecondary },

  // Wellbeing
  wellbeingCard: { backgroundColor: colors.white, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  wbRow:   { flexDirection: 'row', marginBottom: 6 },
  wbKey:   { fontSize: 13, fontWeight: '600', color: colors.textPrimary, width: 155 },
  wbVal:   { fontSize: 13, color: colors.textSecondary },
  wbNote:  { fontSize: 12, color: '#e17055', marginTop: 4, fontStyle: 'italic' },

  // Mood bars
  moodRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  moodEmoji: { fontSize: 16, width: 26 },
  moodLabel: { fontSize: 12, width: 60, color: colors.textPrimary, fontWeight: '500' },
  moodTrack: { flex: 1, height: 7, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  moodFill:  { height: '100%', borderRadius: 4 },
  moodCount: { fontSize: 11, color: colors.textSecondary, width: 22, textAlign: 'right' },

  // No risks
  noRisksRow: { backgroundColor: '#d4faf0', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 14 },
  noRisksText: { fontSize: 13, color: '#00b894', fontWeight: '600' },

  // Risks
  riskCard:     { borderLeftWidth: 4, padding: 12, borderRadius: 10, marginBottom: 10 },
  riskCardFull: { marginBottom: 12 },
  riskSeverity: { fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  riskMsg:      { fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
  viewAllLink:  { color: colors.primary, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 4 },

  // Vitals
  vitalHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  vitalLabel:     { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary, flex: 1 },
  vitalCountBadge: { backgroundColor: '#e8f4ff', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  vitalCountText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  vitalStats:     { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.background, borderRadius: 10, padding: 12 },
  vitalStat:      { alignItems: 'center' },
  vitalStatLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
  vitalStatVal:   { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary },

  // Activity
  activityRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 },
  modalTitle:   { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 16, textAlign: 'center' },
  pickerRow:    { flexDirection: 'row', height: 200, gap: 8 },
  pickerCol:    { flex: 1 },
  pickerItem:   { paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  pickerItemActive:     { backgroundColor: colors.primary },
  pickerItemText:       { fontSize: 14, color: colors.textPrimary },
  pickerItemActiveText: { color: '#fff', fontWeight: 'bold' },
  modalDoneBtn:     { marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  modalDoneBtnText: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
});

export default ReportScreen;