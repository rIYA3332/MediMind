// screens/doctor/DoctorDashboard.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';

interface LatestVital { log_type: string; value: string; unit: string; logged_at: string }
interface LatestRisk  { risk_level: string; risk_score: number; is_critical: number }
interface LatestMood  { mood: string; sentiment_label: string | null }
interface Patient {
  id: number; name: string; dob: string | null; gender: string | null;
  phone: string | null; relationship: string | null;
  unread_alerts: number; active_risks: number; critical_flags: number;
  latest_vitals: LatestVital[]; latest_risk: LatestRisk | null;
  latest_mood: LatestMood | null;
}

function getAge(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}
function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
function getStatusInfo(p: Patient): { label: string; bg: string; text: string } {
  const level = p.latest_risk?.risk_level || '';
  if (p.critical_flags > 0 || level === 'critical') return { label: 'Critical', bg: '#fdecea', text: '#c0392b' };
  if (p.unread_alerts > 0 || level === 'high')       return { label: 'Monitor',  bg: '#fef9e7', text: '#d68910' };
  return                                                      { label: 'Stable',   bg: '#eafaf1', text: '#1e8449' };
}
function getLatestBP(vitals: LatestVital[]): string | null {
  return vitals?.find(v => v.log_type === 'blood_pressure')?.value ?? null;
}
function getLastCheckTime(vitals: LatestVital[]): string | null {
  if (!vitals?.length) return null;
  return vitals.reduce((a, b) => new Date(a.logged_at) > new Date(b.logged_at) ? a : b).logged_at;
}
function isPriority(p: Patient): boolean {
  return p.unread_alerts > 0 || p.critical_flags > 0 ||
    p.latest_risk?.risk_level === 'critical' || p.latest_risk?.risk_level === 'high';
}

const MOOD_EMOJI: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢', anxious: '😰', tired: '😴', lonely: '🧍',
};

const DoctorDashboard = ({ route, navigation }: any) => {
  const { doctorId, doctorName, user } = route.params || {};
  const [patients,   setPatients]   = useState<Patient[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayName = doctorName || user?.name || 'Doctor';
  const lastName    = displayName.split(' ').pop() || displayName;
  const resolvedId  = doctorId || user?.id;

  const loadAll = useCallback(async () => {
    if (!resolvedId) return;
    try {
      const res  = await fetch(getApiUrl(`/api/doctor/patients/${resolvedId}`));
      const data = await res.json();
      setPatients(Array.isArray(data) ? data : []);
    } catch (e) { console.log('Dashboard error:', e); }
  }, [resolvedId]);

  useEffect(() => { loadAll().finally(() => setLoading(false)); }, [loadAll]);

  useEffect(() => {
    pollRef.current = setInterval(loadAll, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadAll]);

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => loadAll());
    return unsub;
  }, [navigation, loadAll]);

  const onRefresh = () => { setRefreshing(true); loadAll().finally(() => setRefreshing(false)); };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          try { await AsyncStorage.multiRemove(['user', 'caregiverId']); } catch {}
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  const openPatient = (p: Patient) => {
    navigation.navigate('PatientDetail', {
      elderId: p.id, elderName: p.name,
      doctorId: resolvedId, doctorName: displayName,
    });
  };

  // Calculate total active risks across all patients
  const totalActiveRisks = patients.reduce((sum, p) => sum + (p.active_risks || 0), 0);
  const priorityPatients = patients.filter(isPriority);
  const stablePatients   = patients.filter(p => !isPriority(p));
  const needsAlert       = patients.filter(p => p.unread_alerts > 0 || p.critical_flags > 0 || p.latest_risk?.risk_level === 'critical' || p.latest_risk?.risk_level === 'high').length;

  if (loading) {
    return (
      <SafeAreaView style={S.screen}>
        <View style={S.loadBox}>
          <ActivityIndicator size="large" color="#2c7da0" />
          <Text style={{ color: '#95a5a6', marginTop: 12 }}>Loading dashboard…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.screen}>
      {/* Header with logout button */}
      <View style={S.header}>
        <View>
          <Text style={S.greeting}>Doctor Dashboard</Text>
          <Text style={S.name}>Dr. {lastName}</Text>
        </View>
        <View style={S.headerRight}>
          <TouchableOpacity style={S.logoutBtn} onPress={handleLogout}>
            <Text style={S.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2c7da0" />}
      >
        {/* Stats Bar - Shows Active Risks instead of Alerts */}
        <View style={S.statsBar}>
          <View style={S.statItem}>
            <Text style={S.statNumber}>{patients.length}</Text>
            <Text style={S.statLabel}>Patients</Text>
          </View>
          <View style={S.statDivider} />
          <View style={S.statItem}>
            <Text style={[S.statNumber, totalActiveRisks > 0 ? { color: '#e17055' } : { color: '#00b894' }]}>
              {totalActiveRisks}
            </Text>
            <Text style={S.statLabel}>Active Risks</Text>
          </View>
          <View style={S.statDivider} />
          <View style={S.statItem}>
            <Text style={[S.statNumber, needsAlert > 0 ? { color: '#ff7675' } : {}]}>{needsAlert}</Text>
            <Text style={S.statLabel}>Need Attention</Text>
          </View>
        </View>

        {/* Priority Patients Section */}
        {priorityPatients.length > 0 && (
          <View style={S.section}>
            <Text style={S.sectionTitle}>⚠️ Priority Patients</Text>
            {priorityPatients.map(p => {
              const age       = getAge(p.dob);
              const bp        = getLatestBP(p.latest_vitals || []);
              const lastCheck = getLastCheckTime(p.latest_vitals || []);
              const isCrit    = p.critical_flags > 0 || p.latest_risk?.risk_level === 'critical';
              // Use active_risks instead of unread_alerts for display
              const riskCount = p.active_risks || 0;
              const alertBg   = isCrit ? '#fdecea' : '#fef9e7';
              const alertClr  = isCrit ? '#c0392b' : '#d68910';
              
              return (
                <TouchableOpacity 
                  key={p.id} 
                  style={[S.priorityCard, isCrit ? S.priorityCardCritical : S.priorityCardMonitor]} 
                  onPress={() => openPatient(p)} 
                  activeOpacity={0.82}
                >
                  <View style={S.priorityTopRow}>
                    <Text style={S.priorityName}>{p.name}{age !== null ? ` (${age})` : ''}</Text>
                    {/* Show active risks badge instead of unread alerts */}
                    {riskCount > 0 && (
                      <View style={S.riskBadge}>
                        <Text style={S.riskBadgeTxt}>{riskCount}</Text>
                      </View>
                    )}
                  </View>
                  
                  {/* CHANGED: Show Active Risks instead of Alerts in the pill */}
                  <View style={[S.alertPill, { backgroundColor: alertBg }]}>
                    <Text style={[S.alertPillTxt, { color: alertClr }]}>
                      {isCrit ? '🚨 Critical Risk' : riskCount > 0 ? `⚠️ ${riskCount} Active Risk${riskCount > 1 ? 's' : ''}` : '⚠️ At Risk'}
                    </Text>
                  </View>
                  
                  <View style={S.priorityMetaRow}>
                    {bp && <Text style={S.priorityMeta}>BP: {bp} mmHg</Text>}
                    {lastCheck && <Text style={S.priorityTime}>{timeAgo(lastCheck)}</Text>}
                  </View>
                  {p.latest_mood && (
                    <Text style={S.moodLine}>
                      {MOOD_EMOJI[p.latest_mood.mood] || '😐'} {p.latest_mood.mood}
                      {p.latest_mood.sentiment_label ? ` · ${p.latest_mood.sentiment_label}` : ''}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Recent Patients Section */}
        {stablePatients.length > 0 && (
          <View style={S.section}>
            <Text style={S.sectionTitle}>📋 Recent Patients</Text>
            <View style={S.recentList}>
              {stablePatients.map((p, idx) => {
                const age       = getAge(p.dob);
                const status    = getStatusInfo(p);
                const lastCheck = getLastCheckTime(p.latest_vitals || []);
                const isLast    = idx === stablePatients.length - 1;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[S.recentRow, !isLast && S.recentRowBorder]}
                    onPress={() => openPatient(p)}
                    activeOpacity={0.75}
                  >
                    <View style={S.recentAv}>
                      <Text style={S.recentAvTxt}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.recentName}>{p.name}{age !== null ? ` (${age})` : ''}</Text>
                      <Text style={S.recentTime}>Last check: {lastCheck ? timeAgo(lastCheck) : 'Never'}</Text>
                    </View>
                    <View style={[S.statusBadge, { backgroundColor: status.bg }]}>
                      <Text style={[S.statusTxt, { color: status.text }]}>{status.label}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {patients.length === 0 && (
          <View style={S.emptyState}>
            <Text style={{ fontSize: 54, marginBottom: 14 }}>👥</Text>
            <Text style={S.emptyTitle}>No patients connected yet</Text>
            <Text style={S.emptySub}>Ask patients to share their registration code.</Text>
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const S = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#f8f9fa' },
  loadBox:  { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 20, 
    paddingBottom: 15, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#e9ecef' 
  },
  greeting: { 
    fontSize: 12, 
    color: '#6c757d', 
    textTransform: 'uppercase', 
    letterSpacing: 0.5 
  },
  name: { 
    fontSize: 22, 
    fontWeight: 'bold', 
    color: '#2c7da0', 
    marginTop: 2 
  },
  headerRight: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 10 
  },
  logoutBtn: { 
    paddingHorizontal: 14, 
    paddingVertical: 8, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#dee2e6',
    backgroundColor: '#f8f9fa'
  },
  logoutBtnText: { 
    fontSize: 13, 
    fontWeight: '600', 
    color: '#495057' 
  },

  statsBar: { 
    flexDirection: 'row', 
    backgroundColor: '#fff', 
    paddingVertical: 14, 
    paddingHorizontal: 12, 
    marginBottom: 4, 
    borderBottomWidth: 1, 
    borderBottomColor: '#e9ecef' 
  },
  statItem: { 
    flex: 1, 
    alignItems: 'center' 
  },
  statDivider: { 
    width: 1, 
    backgroundColor: '#e9ecef' 
  },
  statNumber: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#2c7da0' 
  },
  statLabel: { 
    fontSize: 10, 
    color: '#6c757d', 
    marginTop: 2, 
    textAlign: 'center' 
  },

  section: { 
    paddingHorizontal: 16, 
    marginTop: 16, 
    marginBottom: 8 
  },
  sectionTitle: { 
    fontSize: 13, 
    fontWeight: '700', 
    color: '#6c757d', 
    marginBottom: 12, 
    textTransform: 'uppercase', 
    letterSpacing: 0.5 
  },

  priorityCard: { 
    backgroundColor: '#fff', 
    borderRadius: 12, 
    padding: 16, 
    marginBottom: 12, 
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000', 
    shadowOpacity: 0.04, 
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  priorityCardCritical: {
    borderLeftWidth: 4,
    borderLeftColor: '#c0392b',
  },
  priorityCardMonitor: {
    borderLeftWidth: 4,
    borderLeftColor: '#d68910',
  },
  priorityTopRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 8 
  },
  priorityName: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#212529' 
  },
  riskBadge: { 
    backgroundColor: '#e17055', 
    borderRadius: 10, 
    minWidth: 20, 
    height: 20, 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingHorizontal: 5 
  },
  riskBadgeTxt: { 
    fontSize: 11, 
    fontWeight: '700', 
    color: '#fff' 
  },
  alertPill: { 
    alignSelf: 'flex-start', 
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 6, 
    marginBottom: 8 
  },
  alertPillTxt: { 
    fontSize: 12, 
    fontWeight: '700' 
  },
  priorityMetaRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  priorityMeta: { 
    fontSize: 12, 
    color: '#6c757d' 
  },
  priorityTime: { 
    fontSize: 11, 
    color: '#adb5bd' 
  },
  moodLine: { 
    fontSize: 11, 
    color: '#6c757d', 
    marginTop: 6, 
    fontStyle: 'italic' 
  },

  recentList: { 
    backgroundColor: '#fff', 
    borderRadius: 12, 
    overflow: 'hidden', 
    borderWidth: 1,
    borderColor: '#e9ecef'
  },
  recentRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingVertical: 14, 
    gap: 12 
  },
  recentRowBorder: { 
    borderBottomWidth: 1, 
    borderBottomColor: '#f1f3f5' 
  },
  recentAv: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: '#e3f2fd', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  recentAvTxt: { 
    fontSize: 16, 
    fontWeight: '800', 
    color: '#2c7da0' 
  },
  recentName: { 
    fontSize: 14, 
    fontWeight: '600', 
    color: '#212529' 
  },
  recentTime: { 
    fontSize: 11, 
    color: '#6c757d', 
    marginTop: 2 
  },
  statusBadge: { 
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 20 
  },
  statusTxt: { 
    fontSize: 11, 
    fontWeight: '700' 
  },

  emptyState: { 
    alignItems: 'center', 
    paddingVertical: 60, 
    paddingHorizontal: 30 
  },
  emptyTitle: { 
    fontSize: 17, 
    fontWeight: '700', 
    color: '#212529', 
    marginBottom: 8 
  },
  emptySub: { 
    fontSize: 13, 
    color: '#6c757d', 
    textAlign: 'center', 
    lineHeight: 20 
  },
});

export default DoctorDashboard;