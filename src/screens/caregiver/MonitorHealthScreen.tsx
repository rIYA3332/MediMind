import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface HealthLog {
  id: number;
  log_type: string;
  value: string;
  unit: string;
  notes: string;
  logged_at: string;
}

interface Medication {
  id: number;
  name: string;
  dosage: string;
  frequency: string;
  time: string;
}

interface HealthRisk {
  id: number;
  risk_type: string;
  log_type: string;
  severity: string;
  message: string;
  readings_count: number;
  detected_at: string;
}

type Tab = 'vitals' | 'meds' | 'risks';

const MonitorHealthScreen = ({ route }: any) => {
  const { elderId, elderName } = route.params || {};
  const [activeTab, setActiveTab] = useState<Tab>('vitals');
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [risks, setRisks] = useState<HealthRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { if (elderId) fetchData(); }, [elderId, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'vitals') {
        const res = await fetch(getApiUrl(`/api/health-logs/${elderId}`));
        setHealthLogs(await res.json());
      } else if (activeTab === 'meds') {
        const res = await fetch(getApiUrl(`/api/medications/${elderId}`));
        setMedications(await res.json());
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

  const getHealthIcon = (type: string) => {
    const icons: Record<string, string> = {
      blood_pressure: '💉', blood_sugar: '🩸', weight: '⚖️', temperature: '🌡️', heart_rate: '❤️',
    };
    return icons[type] || '📊';
  };

  const getHealthLabel = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const getValueColor = (type: string, value: string) => {
    if (type === 'blood_pressure') {
      const parts = value.split('/');
      if (parts.length !== 2) return colors.primary;
      const sys = parseInt(parts[0]);
      if (sys > 180) return '#ff4757';
      if (sys > 140) return '#fdcb6e';
      if (sys < 90) return '#74b9ff';
      return '#00b894';
    }
    if (type === 'blood_sugar') {
      const v = parseFloat(value);
      if (v < 54) return '#ff4757';
      if (v < 70) return '#fdcb6e';
      if (v > 180) return '#fdcb6e';
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
      case 'danger':   return { bg: '#fff5f0', border: '#e17055', text: '#e17055', label: '⚠️ DANGER' };
      default:         return { bg: '#fffdf0', border: '#fdcb6e', text: '#856404', label: '⚠️ WARNING' };
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'vitals', label: '📊 Vitals' },
    { key: 'meds',   label: '💊 Medications' },
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
          <TouchableOpacity
            key={key}
            style={[styles.tab, activeTab === key && styles.activeTab]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={[styles.tabText, activeTab === key && styles.activeTabText]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >

          {/* Vitals Tab */}
          {activeTab === 'vitals' && (
            healthLogs.length === 0 ? (
              <Card><Text style={styles.emptyText}>No health logs recorded yet</Text></Card>
            ) : (
              healthLogs.map((log) => {
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
                    {log.notes ? (
                      <Text style={styles.logNotes}>💬 {log.notes}</Text>
                    ) : null}
                  </Card>
                );
              })
            )
          )}

          {/* Medications Tab */}
          {activeTab === 'meds' && (
            medications.length === 0 ? (
              <Card><Text style={styles.emptyText}>No medications recorded yet</Text></Card>
            ) : (
              medications.map((med) => (
                <Card key={med.id} style={styles.medCard}>
                  <View style={styles.medHeader}>
                    <Text style={styles.medName}>{med.name}</Text>
                    <View style={styles.medDosageBadge}>
                      <Text style={styles.medDosageText}>{med.dosage}</Text>
                    </View>
                  </View>
                  <Text style={styles.medDetail}>📅 {med.frequency} at {med.time}</Text>
                </Card>
              ))
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
                    Resolve by consulting a doctor or clearing via the dashboard.
                  </Text>
                </Card>
                {risks.map((risk) => {
                  const s = getSeverityStyle(risk.severity);
                  return (
                    <View key={risk.id} style={[styles.riskCard, { borderLeftColor: s.border, backgroundColor: s.bg }]}>
                      <View style={styles.riskCardHeader}>
                        <Text style={[styles.riskSeverity, { color: s.text }]}>{s.label}</Text>
                        <Text style={styles.riskCardDate}>{formatDate(risk.detected_at)}</Text>
                      </View>
                      <Text style={styles.riskCardMessage}>{risk.message}</Text>
                      <Text style={styles.riskCardReadings}>
                        📊 {risk.readings_count} readings analyzed
                      </Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: 20, backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary },
  tabContainer: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: {
    flex: 1, paddingVertical: 14, alignItems: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  activeTabText: { color: colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, padding: 15 },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },
  // Vitals
  logCard: { marginBottom: 12 },
  logHeader: { flexDirection: 'row', alignItems: 'center' },
  logIcon: { fontSize: 28, marginRight: 12 },
  logInfo: { flex: 1 },
  logType: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary },
  logDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logValueBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  logValueText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  logNotes: {
    fontSize: 12, color: colors.textSecondary, fontStyle: 'italic',
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  // Meds
  medCard: { marginBottom: 12 },
  medHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  medName: { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary, flex: 1 },
  medDosageBadge: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  medDosageText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  medDetail: { fontSize: 13, color: colors.textSecondary },
  // Risks
  noRisksCard: { alignItems: 'center', paddingVertical: 50 },
  noRisksIcon: { fontSize: 60, marginBottom: 16 },
  noRisksTitle: { fontSize: 18, fontWeight: 'bold', color: '#00b894', marginBottom: 8 },
  noRisksText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  riskLegendCard: { marginBottom: 12, backgroundColor: '#f0f8ff' },
  riskLegendText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  riskCard: {
    marginBottom: 12, padding: 14, borderRadius: 12,
    borderLeftWidth: 5,
  },
  riskCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  riskSeverity: { fontSize: 11, fontWeight: 'bold' },
  riskCardDate: { fontSize: 11, color: colors.textSecondary },
  riskCardMessage: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  riskCardReadings: { fontSize: 11, color: colors.textSecondary, marginTop: 8, fontStyle: 'italic' },
});

export default MonitorHealthScreen;