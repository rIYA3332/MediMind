import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface HealthLog {
  id: number; log_type: string; value: string;
  unit: string; notes: string; logged_at: string;
}
interface HealthRisk {
  id: number; risk_type: string; log_type: string;
  severity: string; message: string; readings_count: number; detected_at: string;
}
interface ActivityItem {
  source: 'intake' | 'reminder';
  id: number;
  medication_id: number;
  elder_id: number;
  title: string;
  type: string;
  scheduled_time: string;
  dosage?: string;
  status: string;
  is_overdue: number;
  response_note?: string;
  event_time: string;
  attempt_number?: number;
}

type Tab = 'vitals' | 'meds' | 'risks';

// ── Helpers ───────────────────────────────────────────────────────────────────
const typeIcons: Record<string, string> = {
  medicine: '💊', appointment: '🏥', routine: '🌿', reminder: '🔔',
};

const fmtScheduledTime = (t: string) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtEventTime = (dt: string) => {
  const d = new Date(dt);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const getActivityMeta = (item: ActivityItem) => {
  if (item.source === 'reminder') {
    if (item.status === 'responded')
      return { icon: '✅', label: `Reminder ${item.attempt_number} — Elder responded`, color: '#00b894', bg: '#d4faf0' };
    return { icon: '🔔', label: `Reminder sent (attempt ${item.attempt_number})`, color: '#fdcb6e', bg: '#fff9e6' };
  }
  if (item.is_overdue)
    return { icon: '🚨', label: 'OVERDUE — No response after max reminders', color: '#ff4757', bg: '#fff0f0' };
  if (item.status === 'taken')
    return { icon: '✅', label: 'Taken', color: '#00b894', bg: '#d4faf0' };
  if (item.status === 'missed')
    return { icon: '⏭️', label: 'Skipped', color: '#a29bfe', bg: '#f0eeff' };
  return { icon: '❓', label: item.status, color: '#95a5a6', bg: '#f0f0f0' };
};

// ── Medication Activity Feed ───────────────────────────────────────────────────
const MedActivityFeed = ({ elderId }: { elderId: number }) => {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(1);

  useEffect(() => {
    setLoading(true);
    fetch(getApiUrl(`/api/medication-activity/${elderId}?days=${days}`))
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [elderId, days]);

  return (
    <View style={{ flex: 1 }}>
      {/* Day filter */}
      <View style={styles.dayFilterRow}>
        {([1, 3, 7, 14] as const).map(d => (
          <TouchableOpacity key={d}
            style={[styles.dayFilterBtn, days === d && styles.dayFilterBtnActive]}
            onPress={() => setDays(d)}>
            <Text style={[styles.dayFilterTxt, days === d && styles.dayFilterTxtActive]}>
              {d === 1 ? 'Today' : `${d}d`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <Card style={{ margin: 15 }}>
          <Text style={styles.emptyText}>No medication activity in this period</Text>
        </Card>
      ) : (
        items.map(item => {
          const meta = getActivityMeta(item);
          return (
            <View key={`${item.source}-${item.id}`} style={[styles.actCard, { borderLeftColor: meta.color }]}>
              {/* strip */}
              <View style={[styles.actStrip, { backgroundColor: meta.bg }]}>
                <Text style={[styles.actStripLabel, { color: meta.color }]}>{meta.icon} {meta.label}</Text>
                <Text style={styles.actStripTime}>{fmtEventTime(item.event_time)}</Text>
              </View>
              {/* body */}
              <View style={styles.actBody}>
                <View style={styles.actTitleRow}>
                  <Text style={styles.actTypeIcon}>{typeIcons[item.type] || '📋'}</Text>
                  <Text style={styles.actTitle}>{item.title}</Text>
                </View>
                {item.dosage ? <Text style={styles.actDosage}>💊 {item.dosage}</Text> : null}
                <Text style={styles.actMeta}>🕐 Scheduled {fmtScheduledTime(item.scheduled_time)}</Text>
                {item.response_note ? (
                  <Text style={styles.actNote}>💬 "{item.response_note}"</Text>
                ) : null}
              </View>
            </View>
          );
        })
      )}
      <View style={{ height: 30 }} />
    </View>
  );
};

// ── Main Screen ───────────────────────────────────────────────────────────────
const MonitorHealthScreen = ({ route }: any) => {
  const { elderId, elderName } = route.params || {};
  const [activeTab, setActiveTab] = useState<Tab>('vitals');
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [risks, setRisks] = useState<HealthRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { if (elderId) fetchData(); }, [elderId, activeTab]);

  const fetchData = async () => {
    if (activeTab === 'meds') { setLoading(false); return; } // handled by MedActivityFeed
    setLoading(true);
    try {
      if (activeTab === 'vitals') {
        const res = await fetch(getApiUrl(`/api/health-logs/${elderId}`));
        setHealthLogs(await res.json());
      } else {
        const res = await fetch(getApiUrl(`/api/health-risks/${elderId}`));
        const data = await res.json();
        setRisks(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.log('Fetch error', e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const diff = Date.now() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getHealthIcon = (type: string) => ({
    blood_pressure: '💉', blood_sugar: '🩸', weight: '⚖️', temperature: '🌡️', heart_rate: '❤️',
  }[type] || '📊');

  const getHealthLabel = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const getValueColor = (type: string, value: string) => {
    if (type === 'blood_pressure') {
      const sys = parseInt(value.split('/')[0]);
      if (sys > 180) return '#ff4757';
      if (sys > 140) return '#fdcb6e';
      if (sys < 90) return '#74b9ff';
      return '#00b894';
    }
    if (type === 'blood_sugar') {
      const v = parseFloat(value);
      if (v < 54 || v > 180) return '#ff4757';
      if (v < 70) return '#fdcb6e';
      return '#00b894';
    }
    if (type === 'heart_rate') {
      const v = parseFloat(value);
      if (v > 130 || v < 50) return '#ff4757';
      if (v > 100 || v < 60) return '#fdcb6e';
      return '#00b894';
    }
    if (type === 'temperature') {
      const v = parseFloat(value);
      if (v >= 103) return '#ff4757';
      if (v >= 100.4) return '#fdcb6e';
      return '#00b894';
    }
    return colors.primary;
  };

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return { bg: '#fff0f0', border: '#ff4757', text: '#ff4757', label: '🚨 CRITICAL' };
      case 'danger':   return { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ DANGER'   };
      default:         return { bg: '#fffdf0', border: '#fdcb6e', text: '#856404', label: '⚠️ WARNING'  };
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'vitals', label: '📊 Vitals' },
    { key: 'meds',   label: '💊 Med Activity' },
    { key: 'risks',  label: `⚠️ Risks${risks.length > 0 ? ` (${risks.length})` : ''}` },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {elderName ? `Monitoring: ${elderName}` : 'Health Monitor'}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {TABS.map(({ key, label }) => (
          <TouchableOpacity key={key}
            style={[styles.tab, activeTab === key && styles.activeTab]}
            onPress={() => setActiveTab(key)}>
            <Text style={[styles.tabText, activeTab === key && styles.activeTabText]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Med Activity — rendered outside the loading gate */}
      {activeTab === 'meds' ? (
        <ScrollView style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <MedActivityFeed elderId={elderId} />
        </ScrollView>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

          {/* Vitals Tab */}
          {activeTab === 'vitals' && (
            healthLogs.length === 0 ? (
              <Card><Text style={styles.emptyText}>No health logs recorded yet</Text></Card>
            ) : (
              healthLogs.map(log => {
                const valueColor = getValueColor(log.log_type, log.value);
                return (
                  <Card key={log.id} style={styles.logCard}>
                    <View style={styles.logHeader}>
                      <Text style={styles.logIcon}>{getHealthIcon(log.log_type)}</Text>
                      <View style={styles.logInfo}>
                        <Text style={styles.logType}>{getHealthLabel(log.log_type)}</Text>
                        <Text style={styles.logDate}>{formatDate(log.logged_at)}</Text>
                      </View>
                      <View style={[styles.logValueBadge, { backgroundColor: valueColor }]}>
                        <Text style={styles.logValueText}>{log.value} {log.unit}</Text>
                      </View>
                    </View>
                    {log.notes ? <Text style={styles.logNotes}>💬 {log.notes}</Text> : null}
                  </Card>
                );
              })
            )
          )}

          {/* Risks Tab */}
          {activeTab === 'risks' && (
            risks.length === 0 ? (
              <Card style={styles.noRisksCard}>
                <Text style={styles.noRisksIcon}>✅</Text>
                <Text style={styles.noRisksTitle}>No active health risks</Text>
                <Text style={styles.noRisksText}>
                  All vital signs appear to be within normal ranges.
                  Risks are detected when 3+ abnormal readings occur within 3 days.
                </Text>
              </Card>
            ) : (
              <>
                <Card style={styles.riskLegendCard}>
                  <Text style={styles.riskLegendText}>
                    ℹ️ Risks are triggered when abnormal readings repeat over 3 days.
                  </Text>
                </Card>
                {risks.map(risk => {
                  const s = getSeverityStyle(risk.severity);
                  return (
                    <View key={risk.id} style={[styles.riskCard, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                      <View style={styles.riskCardHeader}>
                        <Text style={[styles.riskSeverity, { color: s.text }]}>{s.label}</Text>
                        <Text style={styles.riskCardDate}>{formatDate(risk.detected_at)}</Text>
                      </View>
                      <Text style={styles.riskCardMessage}>{risk.message}</Text>
                      <Text style={styles.riskCardReadings}>📊 {risk.readings_count} readings analyzed</Text>
                    </View>
                  );
                })}
              </>
            )
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary },

  tabContainer: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  activeTabText: { color: colors.primary },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, padding: 15 },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },

  // Day filter
  dayFilterRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  dayFilterBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  dayFilterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayFilterTxt: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  dayFilterTxtActive: { color: '#fff' },

  // Activity cards
  actCard: { backgroundColor: colors.white, marginHorizontal: 15, marginTop: 8, borderRadius: 12, overflow: 'hidden', borderLeftWidth: 4, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  actStrip: { paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actStripLabel: { fontSize: 12, fontWeight: '700', flex: 1, marginRight: 8 },
  actStripTime: { fontSize: 11, color: colors.textSecondary },
  actBody: { padding: 12 },
  actTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  actTypeIcon: { fontSize: 18 },
  actTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  actDosage: { fontSize: 12, color: '#a29bfe', fontWeight: '600', marginBottom: 3 },
  actMeta: { fontSize: 11, color: colors.textSecondary },
  actNote: { fontSize: 12, color: colors.textSecondary, marginTop: 5, fontStyle: 'italic' },

  // Vitals
  logCard: { marginBottom: 12 },
  logHeader: { flexDirection: 'row', alignItems: 'center' },
  logIcon: { fontSize: 28, marginRight: 12 },
  logInfo: { flex: 1 },
  logType: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary },
  logDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logValueBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  logValueText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  logNotes: { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },

  // Risks
  noRisksCard: { alignItems: 'center', paddingVertical: 50 },
  noRisksIcon: { fontSize: 60, marginBottom: 16 },
  noRisksTitle: { fontSize: 18, fontWeight: 'bold', color: '#00b894', marginBottom: 8 },
  noRisksText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  riskLegendCard: { marginBottom: 12, backgroundColor: '#f0f8ff' },
  riskLegendText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  riskCard: { marginBottom: 12, padding: 14, borderRadius: 12, borderLeftWidth: 5 },
  riskCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  riskSeverity: { fontSize: 11, fontWeight: 'bold' },
  riskCardDate: { fontSize: 11, color: colors.textSecondary },
  riskCardMessage: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  riskCardReadings: { fontSize: 11, color: colors.textSecondary, marginTop: 8, fontStyle: 'italic' },
});

export default MonitorHealthScreen;