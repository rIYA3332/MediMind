import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

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
    if (sys > 140 || dia > 90) return 'Elevated';
    if (sys < 90 || dia < 60) return 'Low';
    return 'Normal Range';
  }
  if (type === 'blood_sugar') {
    const v = parseFloat(value);
    if (v < 54) return 'Critical';
    if (v < 70) return 'Low';
    if (v > 180) return 'Elevated';
    return 'Normal Range';
  }
  if (type === 'heart_rate') {
    const v = parseFloat(value);
    if (v > 130 || v < 50) return 'Critical';
    if (v > 100) return 'Elevated';
    if (v < 60) return 'Low';
    return 'Normal Range';
  }
  if (type === 'temperature') {
    const v = parseFloat(value);
    if (v >= 103) return 'Critical';
    if (v >= 100.4) return 'Elevated';
    if (v < 96) return 'Low';
    return 'Normal Range';
  }
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

const HealthStatusScreen = ({ route, navigation }: any) => {
  const { elderId, elderName } = route.params || {};
  const [latestVitals, setLatestVitals] = useState<LatestVital[]>([]);
  const [recentLogs, setRecentLogs]     = useState<HealthLog[]>([]);
  const [risks, setRisks]               = useState<HealthRisk[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);

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

  const onRefresh = () => { setRefreshing(true); fetchHealthData(); };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const diff = Date.now() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 24) return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (hours < 48) return `Yesterday, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return date.toLocaleDateString() + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  const vitalTypes = Object.keys(vitalConfig).filter(
    type => vitalsMap[type] || recentLogs.some(l => l.log_type === type)
  );

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

        
        <TouchableOpacity
  style={{
    backgroundColor: colors.primary,
    margin: 15,
    marginBottom: 0,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  }}
  onPress={() => navigation.navigate('VitalsTrend', {
    elderId:   elderId,
    elderName: elderName,
  })}>
  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
    📈 View 30-Day Trend Analysis
  </Text>
</TouchableOpacity>
        

        {/* Vital Signs */}
        <Text style={styles.sectionLabel}>Vital Signs</Text>

        {vitalTypes.length === 0 ? (
          <Card style={styles.emptyCard}><Text style={styles.emptyText}>No vital signs recorded yet</Text></Card>
        ) : (
          vitalTypes.map((type) => {
            const config = vitalConfig[type];
            const latest = vitalsMap[type];
            const status = latest ? getValueStatus(type, latest.value) : null;
            const ss = status ? statusStyle(status) : null;
            const typeHistory = recentLogs.filter(l => l.log_type === type).slice(0, 5);

            return (
              <Card key={type} style={styles.vitalCard}>
                <View style={styles.vitalCardHeader}>
                  <Text style={styles.vitalCardIcon}>{config.icon}</Text>
                  <Text style={styles.vitalCardLabel}>{config.label}</Text>
                </View>

                {latest ? (
                  <>
                    <Text style={styles.vitalCardValue}>{latest.value} {config.unit}</Text>
                    <Text style={styles.vitalCardLastRead}>Last reading: {formatDate(latest.logged_at)}</Text>
                    {ss && (
                      <View style={[styles.vitalStatusBadge, { backgroundColor: ss.bg }]}>
                        <Text style={[styles.vitalStatusText, { color: ss.text }]}>{status}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.noDataText}>No readings yet</Text>
                )}

                {/* Trend area */}
                <View style={styles.trendPlaceholder}>
                  {typeHistory.length > 1 ? (
                    <View style={styles.trendMiniBar}>
                      {[...typeHistory].reverse().map((log, idx) => (
                        <View key={idx} style={styles.trendDot}>
                          <Text style={styles.trendDotVal} numberOfLines={1}>{log.value.split('/')[0]}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.trendPlaceholderText}>{config.trendLabel}</Text>
                  )}
                </View>

                {latest && <Text style={styles.vitalAvgNote}>Normal: {config.normalRange} {config.unit}</Text>}
              </Card>
            );
          })
        )}

        {/* Recent Readings */}
        {recentLogs.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Recent Readings</Text>
            <Card>
              {recentLogs.slice(0, 8).map((log) => {
                const status = getValueStatus(log.log_type, log.value);
                const ss = statusStyle(status);
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { padding: 4, marginRight: 8 },
  backIcon: { fontSize: 20, color: colors.primary },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  menuBtn: { padding: 4 },
  menuIcon: { fontSize: 20, color: colors.textSecondary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: colors.textSecondary },
  content: { flex: 1 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, paddingHorizontal: 15, paddingTop: 16, paddingBottom: 8 },
  risksBanner: { margin: 15, marginBottom: 0 },
  risksBannerTitle: { fontSize: 14, fontWeight: 'bold', color: '#e17055', marginBottom: 8 },
  riskItem: { borderLeftWidth: 4, padding: 10, borderRadius: 8, marginBottom: 8 },
  riskSeverityLabel: { fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  riskMessage: { fontSize: 12, color: colors.textPrimary, lineHeight: 17 },
  emptyCard: { marginHorizontal: 15 },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },
  vitalCard: { marginHorizontal: 15, marginBottom: 12 },
  vitalCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  vitalCardIcon: { fontSize: 18, marginRight: 6 },
  vitalCardLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  vitalCardValue: { fontSize: 28, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 2 },
  vitalCardLastRead: { fontSize: 11, color: colors.textSecondary, marginBottom: 6 },
  vitalStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginBottom: 10 },
  vitalStatusText: { fontSize: 12, fontWeight: '600' },
  noDataText: { fontSize: 13, color: colors.textSecondary, marginBottom: 10 },
  trendPlaceholder: { height: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 8, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 6, backgroundColor: '#fafafa' },
  trendPlaceholderText: { fontSize: 12, color: colors.textSecondary },
  trendMiniBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10 },
  trendDot: { alignItems: 'center', flex: 1, backgroundColor: '#e8f4ff', borderRadius: 4, paddingVertical: 4 },
  trendDotVal: { fontSize: 10, color: colors.primary, fontWeight: '600' },
  vitalAvgNote: { fontSize: 11, color: colors.textSecondary },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  logIcon: { fontSize: 22, marginRight: 10 },
  logInfo: { flex: 1 },
  logType: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  logDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  logBadgeText: { fontSize: 12, fontWeight: 'bold' },
});

export default HealthStatusScreen;