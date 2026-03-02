import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, ViewStyle, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface Elder {
  id: number; name: string; dob: string; phone: string;
  emergency_contact: string; relationship: string;
}
interface ElderSummary {
  todayHealthLogs: number;
  todayMood: { mood: string; logged_at: string } | null;
  todayMedsTaken: number; todayMedsTotal: number;
  latestVitals: { log_type: string; value: string; unit: string; logged_at: string }[];
  activeRisksCount: number; unreadAlertsCount: number;
}

const moodEmojis: Record<string, string> = { happy: '😊', neutral: '😐', sad: '😢', anxious: '😰', tired: '😴', lonely: '🪑' };
const healthIcons: Record<string, string> = { blood_pressure: '💉', blood_sugar: '🩸', weight: '⚖️', temperature: '🌡️', heart_rate: '❤️' };

const getMedStatus = (taken: number, total: number) => {
  if (total === 0) return { label: 'No Meds', color: '#95a5a6', bg: '#f0f0f0' };
  const pct = taken / total;
  if (pct >= 1) return { label: 'Complete', color: '#00b894', bg: '#d4faf0' };
  if (pct >= 0.5) return { label: 'On Track', color: '#fdcb6e', bg: '#fff9e6' };
  return { label: 'Missed', color: '#ff7675', bg: '#fff0f0' };
};

const getOverallStatus = (summary: ElderSummary | undefined) => {
  if (!summary) return { color: '#95a5a6', icon: '⏳', label: 'Loading' };
  if (summary.activeRisksCount >= 2) return { color: '#ff4757', icon: '🚨', label: 'Critical' };
  if (summary.activeRisksCount > 0) return { color: '#e17055', icon: '⚠️', label: 'Caution' };
  return { color: '#00b894', icon: '✓', label: 'Good' };
};

const CaregiverDashboard = ({ navigation }: any) => {
  const [caregiver, setCaregiver] = useState<any>(null);
  const [elders, setElders] = useState<Elder[]>([]);
  const [summaries, setSummaries] = useState<Record<number, ElderSummary>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem('user');
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  }, [navigation]);

  const loadData = useCallback(async (caregiverId: number) => {
    try {
      const elderRes = await fetch(getApiUrl(`/api/connections/${caregiverId}`));
      const elderJson = await elderRes.json();
      const elderList: Elder[] = Array.isArray(elderJson) ? elderJson : [];
      setElders(elderList);

      const alertRes = await fetch(getApiUrl(`/api/alerts/caregiver/${caregiverId}`));
      const alertJson = await alertRes.json();
      setUnreadCount(Array.isArray(alertJson) ? alertJson.length : 0);

      if (elderList.length > 0) {
        const summaryEntries = await Promise.all(
          elderList.map(async (elder) => {
            try {
              const res = await fetch(getApiUrl(`/api/elder-summary/${elder.id}`));
              const data = await res.json();
              return [elder.id, data] as [number, ElderSummary];
            } catch { return [elder.id, null] as [number, null]; }
          })
        );
        const map: Record<number, ElderSummary> = {};
        summaryEntries.forEach(([id, data]) => { if (data) map[id] = data; });
        setSummaries(map);
      }
    } catch (e) { console.log('Load error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) { const user = JSON.parse(stored); setCaregiver(user); await loadData(user.id); }
        else setLoading(false);
      } catch (e) { console.log('Init error:', e); setLoading(false); }
    };
    init();
  }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); if (caregiver?.id) loadData(caregiver.id); }, [caregiver]);

  const formatLastUpdated = (vitals: ElderSummary['latestVitals']) => {
    if (!vitals || vitals.length === 0) return null;
    const latest = vitals.reduce((a, b) => new Date(a.logged_at) > new Date(b.logged_at) ? a : b);
    const diff = Date.now() - new Date(latest.logged_at).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} mins ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hours ago`;
    return `${Math.floor(hrs / 24)} day(s) ago`;
  };

  const totalRisks = Object.values(summaries).reduce((a, s) => a + (s?.activeRisksCount || 0), 0);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Caregiver Dashboard</Text>
            <Text style={styles.name}>{caregiver?.name || 'Caregiver'}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.alertBtn} onPress={() => navigation.navigate('Alerts')}>
              <Text style={styles.alertIcon}>🔔</Text>
              {unreadCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutBtnText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsBar}>
          <View style={styles.statItem}><Text style={styles.statNumber}>{elders.length}</Text><Text style={styles.statLabel}>Elders</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}><Text style={[styles.statNumber, unreadCount > 0 ? { color: '#ff7675' } : {}]}>{unreadCount}</Text><Text style={styles.statLabel}>Unread Alerts</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}><Text style={[styles.statNumber, totalRisks > 0 ? { color: '#e17055' } : { color: '#00b894' }]}>{totalRisks}</Text><Text style={styles.statLabel}>Active Risks</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Monitoring</Text>

        {loading ? (
          <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Loading elder data...</Text></View>
        ) : elders.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No elders assigned yet</Text>
            <Text style={styles.emptyText}>Ask an elder to share their registration code. Once they approve your request, they'll appear here.</Text>
          </Card>
        ) : (
          elders.map((elder) => {
            const s = summaries[elder.id];
            const risksCount = s?.activeRisksCount || 0;
            const isCritical = risksCount >= 2;
            const hasRisk = risksCount > 0;
            const overallStatus = getOverallStatus(s);
            const medStatus = getMedStatus(s?.todayMedsTaken || 0, s?.todayMedsTotal || 0);
            const lastUpdated = formatLastUpdated(s?.latestVitals || []);
            const cardStyle: ViewStyle[] = [styles.elderCard];
            if (isCritical) cardStyle.push(styles.elderCardCritical);
            else if (hasRisk) cardStyle.push(styles.elderCardRisk);

            return (
              <Card key={elder.id} style={cardStyle}>
                <View style={styles.elderHeader}>
                  <View style={styles.elderTitleRow}>
                    <View>
                      <Text style={styles.monitoringLabel}>Monitoring</Text>
                      <Text style={styles.elderName}>{elder.name}{elder.relationship ? ` (${elder.relationship})` : ''}</Text>
                    </View>
                    <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate('HealthStatus', { elderId: elder.id, elderName: elder.name })}>
                      <Text style={styles.menuIcon}>☰</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.statusBanner, { borderColor: overallStatus.color, backgroundColor: overallStatus.color + '18' }]}>
                  <Text style={[styles.statusBannerText, { color: overallStatus.color }]}>{overallStatus.icon} Overall Status: {overallStatus.label}</Text>
                  {lastUpdated && <Text style={styles.statusLastUpdated}>Last updated: {lastUpdated}</Text>}
                  <Text style={[styles.statusDetail, { color: overallStatus.color }]}>
                    {hasRisk ? `${risksCount} active health risk${risksCount > 1 ? 's' : ''} detected` : 'All vitals within normal range'}
                  </Text>
                </View>

                <Text style={styles.todaySummaryTitle}>Today's Summary</Text>
                <View style={styles.todayGrid}>
                  <TouchableOpacity style={styles.todayGridItem} onPress={() => navigation.navigate('Monitor', { elderId: elder.id, elderName: elder.name })}>
                    <Text style={styles.gridItemIcon}>💊</Text>
                    <Text style={styles.gridItemTitle}>Medications</Text>
                    <Text style={styles.gridItemValue}>{s?.todayMedsTaken ?? 0}/{s?.todayMedsTotal ?? 0} taken</Text>
                    <View style={[styles.gridItemBadge, { backgroundColor: medStatus.bg }]}><Text style={[styles.gridItemBadgeText, { color: medStatus.color }]}>{medStatus.label}</Text></View>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.todayGridItem} onPress={() => navigation.navigate('HealthStatus', { elderId: elder.id, elderName: elder.name })}>
                    <Text style={styles.gridItemIcon}>📊</Text>
                    <Text style={styles.gridItemTitle}>Health Logs</Text>
                    <Text style={styles.gridItemValue}>{s?.todayHealthLogs ?? 0} entries</Text>
                    <View style={[styles.gridItemBadge, { backgroundColor: (s?.todayHealthLogs ?? 0) > 0 ? '#d4faf0' : '#f0f0f0' }]}>
                      <Text style={[styles.gridItemBadgeText, { color: (s?.todayHealthLogs ?? 0) > 0 ? '#00b894' : '#95a5a6' }]}>{(s?.todayHealthLogs ?? 0) > 0 ? 'Active' : 'None Yet'}</Text>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.todayGridItem}>
                    <Text style={styles.gridItemIcon}>{s?.todayMood ? (moodEmojis[s.todayMood.mood] || '😐') : '😐'}</Text>
                    <Text style={styles.gridItemTitle}>Mood</Text>
                    <Text style={styles.gridItemValue}>{s?.todayMood ? s.todayMood.mood.charAt(0).toUpperCase() + s.todayMood.mood.slice(1) : 'Not logged'}</Text>
                    <View style={[styles.gridItemBadge, { backgroundColor: s?.todayMood && ['sad','anxious','lonely'].includes(s.todayMood.mood) ? '#fff3cd' : '#f0f0f0' }]}>
                      <Text style={[styles.gridItemBadgeText, { color: s?.todayMood && ['sad','anxious','lonely'].includes(s.todayMood.mood) ? '#856404' : '#95a5a6' }]}>
                        {s?.todayMood && ['sad','anxious','lonely'].includes(s.todayMood.mood) ? 'Monitor' : s?.todayMood ? 'Normal' : '—'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.todayGridItem}>
                    <Text style={styles.gridItemIcon}>🏃</Text>
                    <Text style={styles.gridItemTitle}>Activity</Text>
                    <Text style={styles.gridItemValue}>{(s?.todayHealthLogs ?? 0) > 0 ? 'Logged' : 'Not logged'}</Text>
                    <View style={[styles.gridItemBadge, { backgroundColor: (s?.todayHealthLogs ?? 0) > 0 ? '#d4faf0' : '#f0f0f0' }]}>
                      <Text style={[styles.gridItemBadgeText, { color: (s?.todayHealthLogs ?? 0) > 0 ? '#00b894' : '#95a5a6' }]}>{(s?.todayHealthLogs ?? 0) > 0 ? 'Done' : '—'}</Text>
                    </View>
                  </View>
                </View>

                {s && s.latestVitals && s.latestVitals.length > 0 && (
                  <View style={styles.vitalsRow}>
                    {s.latestVitals.slice(0, 4).map((v) => (
                      <View key={v.log_type} style={styles.vitalChip}>
                        <Text style={styles.vitalChipIcon}>{healthIcons[v.log_type] || '📊'}</Text>
                        <Text style={styles.vitalChipValue}>{v.value}</Text>
                        <Text style={styles.vitalChipUnit}>{v.unit}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('HealthStatus', { elderId: elder.id, elderName: elder.name })}>
                    <Text style={styles.actionBtnText}>📊 Health</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Monitor', { elderId: elder.id, elderName: elder.name })}>
                    <Text style={styles.actionBtnText}>🔍 Monitor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => navigation.navigate('WeeklyReport', { elderId: elder.id, elderName: elder.name })}>
                    <Text style={[styles.actionBtnText, { color: '#fff' }]}>📋 Report</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            );
          })
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 15, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  greeting: { fontSize: 12, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 22, fontWeight: 'bold', color: colors.primary, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertBtn: { position: 'relative', padding: 8 },
  alertIcon: { fontSize: 26 },
  badge: { position: 'absolute', top: 2, right: 2, backgroundColor: '#ff4757', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#ff7675' },
  logoutBtnText: { fontSize: 12, fontWeight: '700', color: '#ff7675' },
  statsBar: { flexDirection: 'row', backgroundColor: colors.white, paddingVertical: 14, paddingHorizontal: 20, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: colors.border },
  statNumber: { fontSize: 22, fontWeight: 'bold', color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginHorizontal: 20, marginTop: 14, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  loadingContainer: { alignItems: 'center', paddingVertical: 60 },
  loadingText: { marginTop: 12, color: colors.textSecondary, fontSize: 14 },
  emptyCard: { marginHorizontal: 20, alignItems: 'center', paddingVertical: 50 },
  emptyIcon: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 8 },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  elderCard: { marginHorizontal: 20, marginBottom: 16, padding: 16 },
  elderCardRisk: { borderWidth: 1, borderColor: '#fdcb6e' },
  elderCardCritical: { borderWidth: 1, borderColor: '#ff4757' },
  elderHeader: { marginBottom: 12 },
  elderTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  monitoringLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  elderName: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary, marginTop: 2 },
  menuBtn: { padding: 4 },
  menuIcon: { fontSize: 22, color: colors.textSecondary },
  statusBanner: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  statusBannerText: { fontSize: 14, fontWeight: 'bold', marginBottom: 3 },
  statusLastUpdated: { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  statusDetail: { fontSize: 12, fontWeight: '500' },
  todaySummaryTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  todayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  todayGridItem: { width: '48%', backgroundColor: colors.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
  gridItemIcon: { fontSize: 22, marginBottom: 4 },
  gridItemTitle: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  gridItemValue: { fontSize: 13, color: colors.textSecondary, marginBottom: 6 },
  gridItemBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, alignSelf: 'flex-start' },
  gridItemBadgeText: { fontSize: 11, fontWeight: '600' },
  vitalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  vitalChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8f4ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 3 },
  vitalChipIcon: { fontSize: 13 },
  vitalChipValue: { fontSize: 12, fontWeight: 'bold', color: colors.primary },
  vitalChipUnit: { fontSize: 10, color: colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 10, backgroundColor: colors.background, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  actionBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionBtnText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
});

export default CaregiverDashboard;