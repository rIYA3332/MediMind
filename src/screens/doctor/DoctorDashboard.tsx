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

  const priorityPatients = patients.filter(isPriority);
  const stablePatients   = patients.filter(p => !isPriority(p));
  const needsAlert       = patients.filter(p => p.unread_alerts > 0 || p.critical_flags > 0 || p.latest_risk?.risk_level === 'critical' || p.latest_risk?.risk_level === 'high').length;

  if (loading) {
    return (
      <SafeAreaView style={S.screen}>
        <View style={S.loadBox}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={{ color: '#95a5a6', marginTop: 12 }}>Loading dashboard…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.screen}>
      {/* Page title */}
      <View style={S.titleBar}>
        <Text style={S.titleTxt}>Doctor Dashboard</Text>
        <TouchableOpacity style={S.logoutChip} onPress={handleLogout}>
          <Text style={S.logoutTxt}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3498db" />}
      >
        {/* Header card */}
        <View style={S.headerCard}>
          <View>
            <Text style={S.welcomeTxt}>Welcome Back</Text>
            <Text style={S.drNameTxt}>Dr. {lastName}</Text>
          </View>
          {needsAlert > 0 && (
            <View style={S.liveChip}>
              <View style={S.liveDot} />
              <Text style={S.liveTxt}>Live</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View style={S.statsRow}>
          <View style={S.statCard}>
            <Text style={S.statIcon}>👥</Text>
            <Text style={S.statNum}>{patients.length}</Text>
            <Text style={S.statLbl}>Patients</Text>
            <Text style={S.statSub}>Active monitoring</Text>
          </View>
          <View style={[S.statCard, needsAlert > 0 && S.statCardWarn]}>
            <Text style={S.statIcon}>{needsAlert > 0 ? '⚠️' : '✅'}</Text>
            <Text style={[S.statNum, needsAlert > 0 && { color: '#e17055' }]}>{needsAlert}</Text>
            <Text style={S.statLbl}>Need Attention</Text>
            <Text style={S.statSub}>{needsAlert > 0 ? 'Require review' : 'All stable'}</Text>
          </View>
        </View>

        {/* Priority Patients */}
        {priorityPatients.length > 0 && (
          <View style={S.section}>
            <View style={S.sectionRow}>
              <View style={S.redDot} />
              <Text style={S.sectionTitle}>Priority Patients</Text>
            </View>
            {priorityPatients.map(p => {
              const age       = getAge(p.dob);
              const bp        = getLatestBP(p.latest_vitals || []);
              const lastCheck = getLastCheckTime(p.latest_vitals || []);
              const isCrit    = p.critical_flags > 0 || p.latest_risk?.risk_level === 'critical';
              const alertClr  = isCrit ? '#c0392b' : '#d68910';
              const alertBg   = isCrit ? '#fdecea' : '#fef9e7';
              return (
                <TouchableOpacity key={p.id} style={S.priorityCard} onPress={() => openPatient(p)} activeOpacity={0.82}>
                  <View style={S.priorityTopRow}>
                    <Text style={S.priorityName}>{p.name}{age !== null ? ` (${age})` : ''}</Text>
                    {p.unread_alerts > 0 && (
                      <View style={S.unreadBadge}><Text style={S.unreadBadgeTxt}>{p.unread_alerts}</Text></View>
                    )}
                  </View>
                  <View style={[S.alertPill, { backgroundColor: alertBg }]}>
                    <Text style={[S.alertPillTxt, { color: alertClr }]}>
                      {isCrit ? '🚨 Critical Alert' : p.unread_alerts > 0 ? `⚠️ ${p.unread_alerts} Alert${p.unread_alerts > 1 ? 's' : ''}` : '⚠️ High Risk'}
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

        {/* Recent Patients (stable) */}
        {stablePatients.length > 0 && (
          <View style={S.section}>
            <View style={S.sectionRow}>
              <Text style={{ fontSize: 14 }}>📋</Text>
              <Text style={S.sectionTitle}>Recent Patients</Text>
            </View>
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
  screen:   { flex: 1, backgroundColor: '#f0f2f5' },
  loadBox:  { flex: 1, justifyContent: 'center', alignItems: 'center' },

  titleBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f0f2f5', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  titleTxt:  { fontSize: 17, fontWeight: '600', color: '#7f8c8d' },
  logoutChip:{ backgroundColor: '#fdecea', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#f5b7b1' },
  logoutTxt: { fontSize: 12, fontWeight: '700', color: '#c0392b' },

  headerCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 15, marginBottom: 14, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6 },
  welcomeTxt: { fontSize: 12, color: '#95a5a6', marginBottom: 3 },
  drNameTxt:  { fontSize: 20, fontWeight: '800', color: '#2c3e50' },
  liveChip:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eafaf1', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  liveDot:    { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#27ae60' },
  liveTxt:    { fontSize: 11, fontWeight: '700', color: '#27ae60' },

  statsRow:    { flexDirection: 'row', paddingHorizontal: 15, gap: 12, marginBottom: 18 },
  statCard:    { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, alignItems: 'center' },
  statCardWarn:{ borderWidth: 1, borderColor: '#fdecea' },
  statIcon:    { fontSize: 22, marginBottom: 6 },
  statNum:     { fontSize: 32, fontWeight: '800', color: '#3498db' },
  statLbl:     { fontSize: 13, fontWeight: '600', color: '#2c3e50', marginTop: 2 },
  statSub:     { fontSize: 11, color: '#95a5a6', marginTop: 2 },

  section:     { paddingHorizontal: 15, marginBottom: 18 },
  sectionRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  redDot:      { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e74c3c' },
  sectionTitle:{ fontSize: 15, fontWeight: '700', color: '#2c3e50' },

  priorityCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderLeftWidth: 4, borderLeftColor: '#e74c3c', marginBottom: 10, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 5 },
  priorityTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  priorityName:   { fontSize: 16, fontWeight: '700', color: '#2c3e50' },
  unreadBadge:    { backgroundColor: '#e74c3c', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
  unreadBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },
  alertPill:      { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 8 },
  alertPillTxt:   { fontSize: 12, fontWeight: '700' },
  priorityMetaRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priorityMeta:   { fontSize: 12, color: '#7f8c8d' },
  priorityTime:   { fontSize: 11, color: '#95a5a6' },
  moodLine:       { fontSize: 11, color: '#95a5a6', marginTop: 6, fontStyle: 'italic' },

  recentList:      { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  recentRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  recentRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f4f6f8' },
  recentAv:        { width: 40, height: 40, borderRadius: 20, backgroundColor: '#d6eaf8', justifyContent: 'center', alignItems: 'center' },
  recentAvTxt:     { fontSize: 16, fontWeight: '800', color: '#2980b9' },
  recentName:      { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  recentTime:      { fontSize: 11, color: '#95a5a6', marginTop: 2 },
  statusBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusTxt:       { fontSize: 11, fontWeight: '700' },

  emptyState:{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  emptyTitle:{ fontSize: 17, fontWeight: '700', color: '#2c3e50', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#95a5a6', textAlign: 'center', lineHeight: 20 },
});

export default DoctorDashboard;