import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface WeeklyReport {
  medications: { total: number; taken: number };
  healthLogs: Array<{ log_type: string; count: number; avg_value: number; max_value: string; min_value: string }>;
  mood: Array<{ mood: string; count: number }>;
  alerts: { alert_count: number };
  risks: Array<{ risk_type: string; severity: string; message: string; detected_at: string }>;
  activity: Array<{ activity_type: string; count: number; day: string }>;
  dateRange?: { startDate: string; endDate: string; days: number };
}

type DatePreset = '7' | '14' | '30' | 'custom';
type Section = 'overview' | 'health' | 'mood' | 'risks' | 'activity';

const healthIcons: Record<string, string> = {
  blood_pressure: '💉', blood_sugar: '🩸', weight: '⚖️', temperature: '🌡️', heart_rate: '❤️',
};
const moodEmojis: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢', anxious: '😰', tired: '😴', lonely: '🪑',
};
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'overview',  label: 'Overview'  },
  { key: 'health',    label: 'Health'    },
  { key: 'mood',      label: 'Mood'      },
  { key: 'risks',     label: 'Risks'     },
  { key: 'activity',  label: 'Activity'  },
];

const toISODate = (d: Date) => d.toISOString().split('T')[0];
const addDays   = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const formatDisplay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const WeeklyReportScreen = ({ route, navigation }: any) => {
  const { elderId, elderName } = route.params || {};

  const [preset, setPreset]           = useState<DatePreset>('7');
  const [startDate, setStartDate]     = useState(() => toISODate(addDays(new Date(), -6)));
  const [endDate, setEndDate]         = useState(() => toISODate(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerTarget, setPickerTarget]     = useState<'start' | 'end'>('start');

  const [report, setReport]           = useState<WeeklyReport | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('overview');

  const applyPreset = useCallback((p: DatePreset) => {
    if (p === 'custom') { setPreset('custom'); return; }
    setPreset(p);
    const days = parseInt(p);
    const end  = new Date();
    const start = addDays(end, -(days - 1));
    setStartDate(toISODate(start));
    setEndDate(toISODate(end));
  }, []);

  const fetchReport = useCallback(async (sd?: string, ed?: string) => {
    if (!elderId) return;
    setLoading(true);
    try {
      const s = sd || startDate;
      const e = ed || endDate;
      const res  = await fetch(getApiUrl(`/api/reports/weekly/${elderId}?startDate=${s}&endDate=${e}`));
      const data = await res.json();
      setReport(data);
    } catch (err) { console.log('Fetch report error:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [elderId, startDate, endDate]);

  useEffect(() => { fetchReport(); }, [startDate, endDate]);

  const onRefresh = () => { setRefreshing(true); fetchReport(); };

  const getAdherence   = () => !report || !report.medications.total ? 0 : Math.round((report.medications.taken / report.medications.total) * 100);
  const adherenceColor = (pct: number) => pct >= 90 ? '#00b894' : pct >= 70 ? '#fdcb6e' : '#ff7675';
  const adherenceLabel = (pct: number) => pct >= 90 ? 'Excellent' : pct >= 70 ? 'Good' : 'Needs Improvement';
  const getHealthLabel = (type: string) => type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return { bg: '#fff0f0', border: '#ff4757', text: '#ff4757', label: '🚨 CRITICAL' };
      case 'danger':   return { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ DANGER'   };
      default:         return { bg: '#fffdf0', border: '#fdcb6e', text: '#856404', label: '⚠️ WARNING'  };
    }
  };

  const getMoodColor = (mood: string) => {
    const map: Record<string, string> = { happy: '#00b894', neutral: '#74b9ff', sad: '#ff7675', anxious: '#fdcb6e', tired: '#a29bfe', lonely: '#fd79a8' };
    return map[mood] || colors.textSecondary;
  };

  const adherencePct  = getAdherence();
  const adherenceClr  = adherenceColor(adherencePct);
  const criticalRisks = report?.risks.filter(r => r.severity === 'critical').length || 0;
  const dangerRisks   = report?.risks.filter(r => r.severity === 'danger').length   || 0;

  // ── Simple inline date picker ──────────────────────────────────────────────
  const renderDatePicker = () => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear];
    const days  = Array.from({ length: 31 }, (_, i) => i + 1);

    const parseISO = (iso: string) => { const d = new Date(iso); return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }; };
    const current  = parseISO(pickerTarget === 'start' ? startDate : endDate);

    const setDatePart = (part: 'year' | 'month' | 'day', val: number) => {
      const d = parseISO(pickerTarget === 'start' ? startDate : endDate);
      d[part] = val;
      const iso = toISODate(new Date(d.year, d.month, Math.min(d.day, 28)));
      if (pickerTarget === 'start') setStartDate(iso);
      else setEndDate(iso);
    };

    return (
      <Modal visible={showDatePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
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
            <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowDatePicker(false)}>
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>📊 Weekly Report</Text>
          <Text style={styles.headerSub}>{elderName}</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Text style={styles.refreshBtnText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Date Filter */}
      <View style={styles.dateFilterSection}>
        <View style={styles.presetRow}>
          {(['7','14','30'] as DatePreset[]).map(p => (
            <TouchableOpacity key={p} style={[styles.presetBtn, preset === p && styles.presetBtnActive]} onPress={() => applyPreset(p)}>
              <Text style={[styles.presetBtnText, preset === p && styles.presetBtnActiveText]}>{p} Days</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.presetBtn, preset === 'custom' && styles.presetBtnActive]} onPress={() => applyPreset('custom')}>
            <Text style={[styles.presetBtnText, preset === 'custom' && styles.presetBtnActiveText]}>Custom</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.dateRangeRow}>
          <Text style={styles.weekLabel}>Week of</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => { setPickerTarget('start'); setShowDatePicker(true); setPreset('custom'); }}>
            <Text style={styles.dateBtnText}>{formatDisplay(startDate)}</Text>
          </TouchableOpacity>
          <Text style={styles.dateRangeSep}>→</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => { setPickerTarget('end'); setShowDatePicker(true); setPreset('custom'); }}>
            <Text style={styles.dateBtnText}>{formatDisplay(endDate)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Critical Banner */}
      {!loading && (criticalRisks > 0 || dangerRisks > 0) && (
        <View style={[styles.criticalBanner, criticalRisks > 0 ? styles.criticalBannerRed : styles.criticalBannerOrange]}>
          <Text style={styles.criticalBannerText}>
            {criticalRisks > 0
              ? `🚨 ${criticalRisks} CRITICAL risk${criticalRisks > 1 ? 's' : ''} — immediate attention needed`
              : `⚠️ ${dangerRisks} HIGH risk${dangerRisks > 1 ? 's' : ''} — please review`}
          </Text>
          <TouchableOpacity onPress={() => setActiveSection('risks')}>
            <Text style={styles.criticalBannerLink}>View Risks →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Section Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
        {SECTIONS.map(s => (
          <TouchableOpacity key={s.key} style={[styles.tabChip, activeSection === s.key && styles.tabChipActive]} onPress={() => setActiveSection(s.key)}>
            <Text style={[styles.tabChipText, activeSection === s.key && { color: '#fff' }]}>
              {s.key === 'risks' && report?.risks.length ? `Risks (${report.risks.length})` : s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Generating report...</Text>
          <Text style={styles.loadingSubText}>{formatDisplay(startDate)} – {formatDisplay(endDate)}</Text>
        </View>
      ) : (
        <ScrollView style={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          {/* ── OVERVIEW ── */}
          {activeSection === 'overview' && (
            <>
              <Card style={styles.summaryCard}>
                <Text style={styles.summaryCardTitle}>📝 Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Medication Adherence:</Text>
                  <Text style={[styles.summaryVal, { color: adherenceClr }]}>{adherencePct}%</Text>
                  <View style={[styles.summaryBadge, { backgroundColor: adherenceClr + '22' }]}>
                    <Text style={[styles.summaryBadgeText, { color: adherenceClr }]}>{adherenceLabel(adherencePct)}</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${adherencePct}%` as any, backgroundColor: adherenceClr }]} />
                </View>
                <View style={[styles.summaryRow, { marginTop: 12 }]}>
                  <Text style={styles.summaryKey}>Health Monitoring:</Text>
                  <Text style={styles.summaryVal}>{report?.healthLogs.reduce((a, l) => a + l.count, 0) || 0} entries</Text>
                  <View style={[styles.summaryBadge, { backgroundColor: '#d4faf0' }]}>
                    <Text style={[styles.summaryBadgeText, { color: '#00b894' }]}>
                      {(report?.healthLogs.reduce((a, l) => a + l.count, 0) || 0) > 0 ? 'Regular' : 'Low'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.summaryRow, { marginTop: 8 }]}>
                  <Text style={styles.summaryKey}>Mood Tracking:</Text>
                  <Text style={styles.summaryVal}>{report?.mood.reduce((a, m) => a + m.count, 0) || 0}/7 days</Text>
                  <View style={[styles.summaryBadge, { backgroundColor: '#d4faf0' }]}>
                    <Text style={[styles.summaryBadgeText, { color: '#00b894' }]}>
                      {(report?.mood.reduce((a, m) => a + m.count, 0) || 0) >= 5 ? 'Good' : 'Fair'}
                    </Text>
                  </View>
                </View>
              </Card>

              {report?.healthLogs.map((log) => (
                <Card key={log.log_type} style={styles.healthSummaryCard}>
                  <Text style={styles.healthSummaryTitle}>{healthIcons[log.log_type] || '📊'} {getHealthLabel(log.log_type)} Trends</Text>
                  <View style={styles.chartPlaceholder}>
                    <Text style={styles.chartPlaceholderText}>Weekly {getHealthLabel(log.log_type)} Chart</Text>
                  </View>
                  {log.avg_value != null && (
                    <Text style={styles.avgNote}>Average: {Number(log.avg_value).toFixed(1)} ({log.log_type === 'blood_pressure' ? 'Normal' : 'Good Control'})</Text>
                  )}
                </Card>
              ))}

              {report && report.mood.length > 0 && (() => {
                const topMood  = report.mood.reduce((a, b) => a.count > b.count ? a : b);
                const sadDays  = report.mood.filter(m => ['sad','lonely','anxious'].includes(m.mood)).reduce((a, m) => a + m.count, 0);
                const happyDays = report.mood.filter(m => m.mood === 'happy').reduce((a, m) => a + m.count, 0);
                return (
                  <Card style={styles.wellbeingCard}>
                    <Text style={styles.wellbeingCardTitle}>Emotional Well-being</Text>
                    <View style={styles.wbRow}><Text style={styles.wbKey}>Predominant Mood:</Text><Text style={styles.wbVal}>{topMood.mood.charAt(0).toUpperCase() + topMood.mood.slice(1)}</Text></View>
                    <View style={styles.wbRow}><Text style={styles.wbKey}>Days Happy:</Text><Text style={styles.wbVal}>{happyDays} days</Text></View>
                    {sadDays > 0 && <View style={styles.wbRow}><Text style={styles.wbKey}>Days Sad/Lonely:</Text><Text style={[styles.wbVal, { color: '#e17055' }]}>{sadDays} days</Text></View>}
                    {sadDays > 2 && <Text style={styles.wbNote}>Note: Consider increasing social interaction</Text>}
                  </Card>
                );
              })()}

              <Card>
                <View style={styles.alertsSummaryRow}>
                  <Text style={{ fontSize: 32 }}>🔔</Text>
                  <View style={{ marginLeft: 14 }}>
                    <Text style={styles.alertsSummaryValue}>{report?.alerts.alert_count || 0}</Text>
                    <Text style={styles.alertsSummaryLabel}>{(report?.alerts.alert_count || 0) === 1 ? 'Alert' : 'Alerts'} in this period</Text>
                  </View>
                </View>
              </Card>
            </>
          )}

          {/* ── HEALTH ── */}
          {activeSection === 'health' && (
            !report?.healthLogs.length ? (
              <Card><Text style={styles.emptyText}>No health logs in this period</Text></Card>
            ) : report.healthLogs.map((log) => (
              <Card key={log.log_type} style={styles.vitalCard}>
                <View style={styles.vitalHeader}>
                  <Text style={styles.vitalIcon}>{healthIcons[log.log_type] || '📊'}</Text>
                  <Text style={styles.vitalLabel}>{getHealthLabel(log.log_type)}</Text>
                  <View style={styles.vitalCountBadge}><Text style={styles.vitalCountText}>{log.count} logs</Text></View>
                </View>
                <View style={styles.vitalStats}>
                  {log.avg_value != null && (
                    <View style={styles.vitalStat}>
                      <Text style={styles.vitalStatLabel}>Average</Text>
                      <Text style={styles.vitalStatValue}>{Number(log.avg_value).toFixed(1)}</Text>
                    </View>
                  )}
                  <View style={styles.vitalStat}>
                    <Text style={styles.vitalStatLabel}>Min</Text>
                    <Text style={[styles.vitalStatValue, { color: '#00b894' }]}>{log.min_value}</Text>
                  </View>
                  <View style={styles.vitalStat}>
                    <Text style={styles.vitalStatLabel}>Max</Text>
                    <Text style={[styles.vitalStatValue, { color: '#e17055' }]}>{log.max_value}</Text>
                  </View>
                </View>
              </Card>
            ))
          )}

          {/* ── MOOD ── */}
          {activeSection === 'mood' && (
            !report?.mood.length ? (
              <Card><Text style={styles.emptyText}>No mood data in this period</Text></Card>
            ) : (
              <Card style={{ marginBottom: 15 }}>
                <Text style={styles.sectionTitle}>😊 Mood Distribution</Text>
                {report.mood.map((item) => {
                  const total = report.mood.reduce((a, m) => a + m.count, 0);
                  const pct   = Math.round((item.count / total) * 100);
                  return (
                    <View key={item.mood} style={styles.moodBarRow}>
                      <Text style={styles.moodBarEmoji}>{moodEmojis[item.mood] || '😐'}</Text>
                      <Text style={styles.moodBarLabel}>{item.mood.charAt(0).toUpperCase() + item.mood.slice(1)}</Text>
                      <View style={styles.moodBarTrack}>
                        <View style={[styles.moodBarFill, { width: `${pct}%` as any, backgroundColor: getMoodColor(item.mood) }]} />
                      </View>
                      <Text style={styles.moodBarCount}>{item.count}×</Text>
                    </View>
                  );
                })}
              </Card>
            )
          )}

          {/* ── RISKS ── */}
          {activeSection === 'risks' && (
            !report?.risks.length ? (
              <Card style={styles.noRisksCard}>
                <Text style={{ fontSize: 56, marginBottom: 14 }}>✅</Text>
                <Text style={styles.noRisksTitle}>No health risks detected</Text>
                <Text style={styles.noRisksText}>All vital signs within normal ranges in this period.</Text>
              </Card>
            ) : (
              <>
                <Card style={styles.riskExplainerCard}>
                  <Text style={styles.riskExplainerText}>ℹ️ Risks are automatically detected when 3+ abnormal readings occur within 3 days.</Text>
                </Card>
                {report.risks.map((risk, i) => {
                  const s = getSeverityStyle(risk.severity);
                  return (
                    <View key={i} style={[styles.riskFullCard, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                      <View style={styles.riskFullHeader}>
                        <Text style={[styles.riskFullSeverity, { color: s.text }]}>{s.label}</Text>
                        <Text style={styles.riskFullDate}>{new Date(risk.detected_at).toLocaleDateString()}</Text>
                      </View>
                      <Text style={styles.riskFullType}>{risk.risk_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</Text>
                      <Text style={styles.riskFullMessage}>{risk.message}</Text>
                    </View>
                  );
                })}
              </>
            )
          )}

          {/* ── ACTIVITY ── */}
          {activeSection === 'activity' && (
            !report?.activity.length ? (
              <Card><Text style={styles.emptyText}>No activity data in this period</Text></Card>
            ) : (
              <Card>
                <Text style={styles.sectionTitle}>📅 Activity Log</Text>
                {report.activity.map((item, i) => {
                  const meta: Record<string, { icon: string; label: string; color: string }> = {
                    health_log:        { icon: '📊', label: 'Health Logged',     color: '#00b894' },
                    mood_log:          { icon: '😊', label: 'Mood Recorded',      color: '#74b9ff' },
                    medication_taken:  { icon: '💊', label: 'Medication Taken',   color: '#a29bfe' },
                    medication_missed: { icon: '⚠️', label: 'Medication Missed', color: '#ff7675' },
                  };
                  const info = meta[item.activity_type] || { icon: '📌', label: item.activity_type, color: colors.textSecondary };
                  return (
                    <View key={i} style={styles.activityRow}>
                      <Text style={styles.activityIcon}>{info.icon}</Text>
                      <View style={styles.activityInfo}>
                        <Text style={styles.activityLabel}>{info.label}</Text>
                        <Text style={styles.activityDate}>{new Date(item.day).toLocaleDateString()}</Text>
                      </View>
                      <View style={[styles.activityCountBadge, { backgroundColor: info.color }]}>
                        <Text style={styles.activityCountText}>{item.count}×</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { padding: 4, marginRight: 8 },
  backIcon: { fontSize: 20, color: colors.primary },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: colors.textPrimary },
  headerSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  refreshBtnText: { fontSize: 16, color: colors.primary, fontWeight: 'bold' },
  dateFilterSection: { backgroundColor: colors.white, paddingHorizontal: 15, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  presetBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  presetBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetBtnText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  presetBtnActiveText: { color: '#fff' },
  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  dateBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#e8f4ff', borderWidth: 1, borderColor: '#b3d8f5' },
  dateBtnText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  dateRangeSep: { fontSize: 14, color: colors.textSecondary },
  criticalBanner: { padding: 12, alignItems: 'center' },
  criticalBannerRed: { backgroundColor: '#ff4757' },
  criticalBannerOrange: { backgroundColor: '#e17055' },
  criticalBannerText: { color: '#fff', fontWeight: 'bold', fontSize: 12, textAlign: 'center' },
  criticalBannerLink: { color: '#ffe', fontSize: 11, fontWeight: '600', marginTop: 3 },
  tabBar: { backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, maxHeight: 52 },
  tabChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8, backgroundColor: colors.white },
  tabChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: colors.textSecondary, fontSize: 15 },
  loadingSubText: { marginTop: 4, color: colors.textSecondary, fontSize: 12 },
  content: { flex: 1, padding: 15 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 12 },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },
  summaryCard: { marginBottom: 12 },
  summaryCardTitle: { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  summaryKey: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  summaryVal: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  summaryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  summaryBadgeText: { fontSize: 11, fontWeight: '600' },
  progressTrack: { height: 8, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  progressFill: { height: '100%', borderRadius: 4 },
  healthSummaryCard: { marginBottom: 12 },
  healthSummaryTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  chartPlaceholder: { height: 100, borderWidth: 1, borderColor: colors.border, borderRadius: 8, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fafafa', marginBottom: 8 },
  chartPlaceholderText: { fontSize: 12, color: colors.textSecondary },
  avgNote: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  wellbeingCard: { marginBottom: 12 },
  wellbeingCardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  wbRow: { flexDirection: 'row', marginBottom: 6 },
  wbKey: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, width: 150 },
  wbVal: { fontSize: 13, color: colors.textSecondary },
  wbNote: { fontSize: 12, color: '#e17055', marginTop: 6, fontStyle: 'italic' },
  alertsSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  alertsSummaryValue: { fontSize: 26, fontWeight: 'bold', color: colors.primary },
  alertsSummaryLabel: { fontSize: 12, color: colors.textSecondary },
  vitalCard: { marginBottom: 12 },
  vitalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  vitalIcon: { fontSize: 24, marginRight: 8 },
  vitalLabel: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary, flex: 1 },
  vitalCountBadge: { backgroundColor: '#e8f4ff', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  vitalCountText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  vitalStats: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.background, borderRadius: 10, padding: 12 },
  vitalStat: { alignItems: 'center' },
  vitalStatLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
  vitalStatValue: { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary },
  moodBarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  moodBarEmoji: { fontSize: 18, width: 28 },
  moodBarLabel: { fontSize: 12, width: 60, color: colors.textPrimary, fontWeight: '500' },
  moodBarTrack: { flex: 1, height: 8, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  moodBarFill: { height: '100%', borderRadius: 4 },
  moodBarCount: { fontSize: 12, color: colors.textSecondary, width: 24, textAlign: 'right' },
  noRisksCard: { alignItems: 'center', paddingVertical: 50 },
  noRisksTitle: { fontSize: 17, fontWeight: 'bold', color: '#00b894', marginBottom: 8 },
  noRisksText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  riskExplainerCard: { marginBottom: 10, backgroundColor: '#f0f8ff' },
  riskExplainerText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  riskFullCard: { marginBottom: 10, padding: 14, borderRadius: 12, borderLeftWidth: 5 },
  riskFullHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  riskFullSeverity: { fontSize: 11, fontWeight: 'bold' },
  riskFullDate: { fontSize: 11, color: colors.textSecondary },
  riskFullType: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 5 },
  riskFullMessage: { fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityIcon: { fontSize: 22, marginRight: 10 },
  activityInfo: { flex: 1 },
  activityLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  activityDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  activityCountBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  activityCountText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 380 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 16, textAlign: 'center' },
  pickerRow: { flexDirection: 'row', height: 200, gap: 8 },
  pickerCol: { flex: 1 },
  pickerItem: { paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  pickerItemActive: { backgroundColor: colors.primary },
  pickerItemText: { fontSize: 14, color: colors.textPrimary },
  pickerItemActiveText: { color: '#fff', fontWeight: 'bold' },
  modalDoneBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  modalDoneBtnText: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
});

export default WeeklyReportScreen;