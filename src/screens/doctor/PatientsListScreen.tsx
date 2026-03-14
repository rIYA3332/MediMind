// screens/doctor/PatientsListScreen.tsx
// Patients tab — shows all connected patients, tap to open detail
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  if (p.critical_flags > 0 || level === 'critical')
    return { label: 'Critical', bg: '#fdecea', text: '#c0392b' };
  if (p.unread_alerts > 0 || level === 'high')
    return { label: 'Monitor', bg: '#fef9e7', text: '#d68910' };
  return { label: 'Stable', bg: '#eafaf1', text: '#1e8449' };
}

function getLatestBP(vitals: LatestVital[]): string | null {
  return vitals?.find(v => v.log_type === 'blood_pressure')?.value ?? null;
}

function getLastCheckTime(vitals: LatestVital[]): string | null {
  if (!vitals?.length) return null;
  return vitals.reduce((a, b) => new Date(a.logged_at) > new Date(b.logged_at) ? a : b).logged_at;
}

const MOOD_EMOJI: Record<string, string> = {
  happy: '😊', neutral: '😐', sad: '😢', anxious: '😰', tired: '😴', lonely: '🧍',
};

const PatientsListScreen = ({ route, navigation }: any) => {
  const { doctorId, doctorName, user } = route.params || {};
  const resolvedId  = doctorId || user?.id;
  const displayName = doctorName || user?.name || 'Doctor';

  const [patients,   setPatients]   = useState<Patient[]>([]);
  const [filtered,   setFiltered]   = useState<Patient[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState('');

  const load = useCallback(async () => {
    if (!resolvedId) return;
    try {
      const res  = await fetch(getApiUrl(`/api/doctor/patients/${resolvedId}`));
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setPatients(list);
      setFiltered(list);
    } catch (e) { console.log('PatientsList error:', e); }
  }, [resolvedId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const onSearch = (txt: string) => {
    setSearch(txt);
    if (!txt.trim()) { setFiltered(patients); return; }
    const q = txt.toLowerCase();
    setFiltered(patients.filter(p => p.name.toLowerCase().includes(q)));
  };

  const openPatient = (p: Patient) => {
    navigation.navigate('PatientDetail', {
      elderId:    p.id,
      elderName:  p.name,
      doctorId:   resolvedId,
      doctorName: displayName,
    });
  };

  const renderItem = ({ item: p, index }: { item: Patient; index: number }) => {
    const age       = getAge(p.dob);
    const status    = getStatusInfo(p);
    const lastCheck = getLastCheckTime(p.latest_vitals || []);
    const bp        = getLatestBP(p.latest_vitals || []);
    const isPriority = p.unread_alerts > 0 || p.critical_flags > 0 || p.latest_risk?.risk_level === 'critical' || p.latest_risk?.risk_level === 'high';

    return (
      <TouchableOpacity
        style={[S.row, isPriority && S.rowPriority]}
        onPress={() => openPatient(p)}
        activeOpacity={0.78}
      >
        {/* Avatar */}
        <View style={[S.avatar, { backgroundColor: isPriority ? '#fdecea' : '#d6eaf8' }]}>
          <Text style={[S.avatarTxt, { color: isPriority ? '#c0392b' : '#2980b9' }]}>
            {p.name.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Info */}
        <View style={{ flex: 1 }}>
          <View style={S.nameRow}>
            <Text style={S.name}>{p.name}{age !== null ? ` (${age})` : ''}</Text>
            {p.unread_alerts > 0 && (
              <View style={S.alertBadge}>
                <Text style={S.alertBadgeTxt}>{p.unread_alerts}</Text>
              </View>
            )}
          </View>
          <View style={S.metaRow}>
            {bp && <Text style={S.meta}>BP: {bp}</Text>}
            {bp && lastCheck && <Text style={S.metaDot}>·</Text>}
            {lastCheck && <Text style={S.meta}>{timeAgo(lastCheck)}</Text>}
          </View>
          {p.latest_mood && (
            <Text style={S.mood}>
              {MOOD_EMOJI[p.latest_mood.mood] || '😐'} {p.latest_mood.mood}
            </Text>
          )}
          {p.relationship && (
            <Text style={S.relation}>{p.relationship}</Text>
          )}
        </View>

        {/* Status */}
        <View style={S.rightCol}>
          <View style={[S.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[S.statusTxt, { color: status.text }]}>{status.label}</Text>
          </View>
          <Text style={S.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={S.screen}>
      {/* Header */}
      <View style={S.header}>
        <Text style={S.headerTitle}>Patients</Text>
        <View style={S.headerBadge}>
          <Text style={S.headerBadgeTxt}>{patients.length}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={S.searchRow}>
        <View style={S.searchBox}>
          <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
          <TextInput
            style={S.searchInput}
            value={search}
            onChangeText={onSearch}
            placeholder="Search patients..."
            placeholderTextColor="#aaa"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => onSearch('')}>
              <Text style={{ fontSize: 18, color: '#aaa' }}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Stats summary row */}
      {!loading && patients.length > 0 && (
        <View style={S.summaryRow}>
          <View style={S.summaryChip}>
            <Text style={[S.summaryNum, { color: '#3498db' }]}>{patients.length}</Text>
            <Text style={S.summaryLbl}>Total</Text>
          </View>
          <View style={S.summaryChip}>
            <Text style={[S.summaryNum, { color: '#1e8449' }]}>
              {patients.filter(p => !p.unread_alerts && !p.critical_flags && p.latest_risk?.risk_level !== 'critical' && p.latest_risk?.risk_level !== 'high').length}
            </Text>
            <Text style={S.summaryLbl}>Stable</Text>
          </View>
          <View style={S.summaryChip}>
            <Text style={[S.summaryNum, { color: '#d68910' }]}>
              {patients.filter(p => p.unread_alerts > 0 || p.latest_risk?.risk_level === 'high').length}
            </Text>
            <Text style={S.summaryLbl}>Monitor</Text>
          </View>
          <View style={S.summaryChip}>
            <Text style={[S.summaryNum, { color: '#c0392b' }]}>
              {patients.filter(p => p.critical_flags > 0 || p.latest_risk?.risk_level === 'critical').length}
            </Text>
            <Text style={S.summaryLbl}>Critical</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={S.loadBox}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={{ color: '#95a5a6', marginTop: 12 }}>Loading patients…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 15, paddingTop: 8, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3498db" />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <View style={S.emptyBox}>
              <Text style={{ fontSize: 42, marginBottom: 12 }}>👥</Text>
              <Text style={S.emptyTitle}>
                {search ? 'No patients match your search' : 'No patients connected yet'}
              </Text>
              {!search && (
                <Text style={S.emptySub}>Ask patients to share their registration code to connect.</Text>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const S = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#f0f2f5' },
  loadBox:  { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ecf0f1' },
  headerTitle:  { fontSize: 20, fontWeight: '800', color: '#2c3e50', flex: 1 },
  headerBadge:  { backgroundColor: '#3498db', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  headerBadgeTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },

  searchRow: { backgroundColor: '#fff', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ecf0f1' },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f2f5', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#2c3e50' },

  summaryRow:  { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ecf0f1', gap: 8 },
  summaryChip: { flex: 1, alignItems: 'center', backgroundColor: '#f8f9fa', borderRadius: 10, paddingVertical: 8 },
  summaryNum:  { fontSize: 18, fontWeight: '800' },
  summaryLbl:  { fontSize: 10, color: '#95a5a6', marginTop: 2 },

  row: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
  },
  rowPriority: { borderLeftWidth: 4, borderLeftColor: '#e74c3c' },

  avatar:    { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  avatarTxt: { fontSize: 18, fontWeight: '800' },

  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:     { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  alertBadge:    { backgroundColor: '#e74c3c', borderRadius: 9, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  alertBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#fff' },

  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  meta:     { fontSize: 12, color: '#7f8c8d' },
  metaDot:  { fontSize: 12, color: '#bdc3c7' },
  mood:     { fontSize: 11, color: '#95a5a6', marginTop: 3 },
  relation: { fontSize: 11, color: '#aab7c4', marginTop: 2, fontStyle: 'italic' },

  rightCol:    { alignItems: 'flex-end', gap: 6 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusTxt:   { fontSize: 11, fontWeight: '700' },
  chevron:     { fontSize: 20, color: '#bdc3c7', fontWeight: '300' },

  emptyBox:  { alignItems: 'center', paddingVertical: 60 },
  emptyTitle:{ fontSize: 16, fontWeight: '700', color: '#2c3e50', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#95a5a6', textAlign: 'center', paddingHorizontal: 30 },
});

export default PatientsListScreen;