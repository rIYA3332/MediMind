import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { useLang } from '../../context/LanguageContext'

interface Medication {
  id: number;
  name: string;
  dosage: string | null;
  frequency: string | null;
  time: string | null;
  days: string[];
  timing: string;
  taken_today: number;
}

// ─── SAFE: parse "HH:MM" or "HH:MM:SS" → { hours, minutes }
// Returns null if the string is not a valid time
function parseTime(raw: string | null | undefined): { hours: number; minutes: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || !s.includes(':')) return null;
  const parts = s.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return { hours: h, minutes: m };
}

const MedicationScreen: React.FC = () => {
  const { t } = useLang();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [userId,      setUserId]      = useState<number | null>(null);

  useEffect(() => { loadUser(); }, []);
  useEffect(() => { if (userId) fetchMedications(); }, [userId]);

  const loadUser = async () => {
    try {
      const user = await AsyncStorage.getItem('user');
      if (user) setUserId(JSON.parse(user).id);
    } catch (e) {
      console.log('loadUser error', e);
    }
  };

  const fetchMedications = async () => {
    setLoading(true);
    try {
      const res  = await fetch(getApiUrl(`/api/medications/today/${userId}`));
      const data = await res.json();
      setMedications(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log('Fetch medications error', e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMedications();
    setRefreshing(false);
  };

  const updateStatus = async (medication: Medication, status: 'taken' | 'skipped') => {
    try {
      const res = await fetch(getApiUrl('/api/medications/mark-taken'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ medicationId: medication.id, userId, status }),
      });
      if (res.ok) {
        Alert.alert(status === 'taken' ? '✅ Taken' : '❌ Not Taken', `${medication.name} updated`);
        fetchMedications();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update medication');
    }
  };

  // ─── BULLETPROOF getDueStatus ──────────────────────────────────────────────
  // All paths are safe — no raw .split() on an unguarded value
  const getDueStatus = (rawTime: string | null | undefined, takenToday: number) => {
    if (takenToday > 0) {
      return { label: '✓ Taken', color: '#4caf50', textColor: '#fff' };
    }

    const parsed = parseTime(rawTime);   // returns null if time is missing / invalid
    if (!parsed) {
      // Doctor-prescribed med with no scheduled time yet
      return { label: 'Pending', color: '#e0e0e0', textColor: '#666' };
    }

    const { hours, minutes } = parsed;
    const now     = new Date();
    const medDate = new Date();
    medDate.setHours(hours, minutes, 0, 0);

    const minutesLeft = Math.floor((medDate.getTime() - now.getTime()) / 60000);

    if (minutesLeft < -30) return { label: 'Overdue',  color: '#f44336', textColor: '#fff' };
    if (minutesLeft < 0)   return { label: 'Due Now',  color: '#ff9800', textColor: '#fff' };
    if (minutesLeft < 60)  return { label: 'Upcoming', color: '#2196f3', textColor: '#fff' };

    return { label: 'Pending', color: '#e0e0e0', textColor: '#666' };
  };

// replace fmtTime's fallback
  const fmtTime = (raw: string | null | undefined) => {
  const parsed = parseTime(raw);
  if (!parsed) return '';
    const { hours, minutes } = parsed;
    const period = hours >= 12 ? 'PM' : 'AM';
    const h12    = hours % 12 || 12;
    return `${h12}:${String(minutes).padStart(2, '0')} ${period}`;
  };

  const dueNow       = medications.filter(m => getDueStatus(m.time, m.taken_today).label === 'Due Now');
  const upcoming     = medications.filter(m => getDueStatus(m.time, m.taken_today).label === 'Upcoming');
  const todaySchedule = medications.filter(m => {
    const lbl = getDueStatus(m.time, m.taken_today).label;
    return lbl !== 'Due Now' && lbl !== 'Upcoming';
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('myMedications')}</Text>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : medications.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('noMedications')}</Text>
          </Card>
        ) : (
          <>
            {/* ── Due Now ───────────────────────────────────────── */}
            {dueNow.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('dueNow')}</Text>
                {dueNow.map(med => (
                  <Card key={med.id} style={styles.dueCard}>
                    <Text style={styles.medName}>{med.name}</Text>
                    <Text style={styles.medDetails}>
                      {med.dosage || '—'} • {fmtTime(med.time)}
                    </Text>
                    <View style={styles.actionButtons}>
                      <TouchableOpacity style={styles.takenButton} onPress={() => updateStatus(med, 'taken')}>
                        <Text style={styles.takenButtonText}>{t('takenBtn')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.notTakenButton} onPress={() => updateStatus(med, 'skipped')}>
                        <Text style={styles.notTakenButtonText}>{t('notTakenBtn')}</Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))}
              </>
            )}

            {/* ── Upcoming ──────────────────────────────────────── */}
            {upcoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('upcoming')}</Text>
                {upcoming.map(med => (
                  <Card key={med.id}>
                    <Text style={styles.medName}>{med.name}</Text>
                    <Text style={styles.medDetails}>
  {med.dosage || '—'}{fmtTime(med.time) ? ` • ${fmtTime(med.time)}` : ''}
</Text>
                    
                  </Card>
                ))}
              </>
            )}

            {/* ── Today (all others) ────────────────────────────── */}
            {todaySchedule.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('todaySchedule')}</Text>
                {todaySchedule.map(med => {
                  const status = getDueStatus(med.time, med.taken_today);
                  const isDrPrescribed = !med.time && med.taken_today === 0;
                  return (
                    <Card key={med.id}>
                      <Text style={styles.medName}>{med.name}</Text>
                      <Text style={styles.medDetails}>
                        {med.dosage || '—'} • {fmtTime(med.time)}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
                        <Text style={{ color: status.textColor, fontSize: 12, fontWeight: '600' }}>
                          {status.label}
                        </Text>
                      </View>
                      
                    </Card>
                  );
                })}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default MedicationScreen;

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: colors.background },
  header:           { padding: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:      { fontSize: 20, fontWeight: 'bold', color: colors.textPrimary },
  content:          { flex: 1, padding: 15 },
  sectionTitle:     { fontSize: 16, fontWeight: 'bold', marginVertical: 10 },
  emptyText:        { textAlign: 'center', padding: 20, color: colors.textSecondary },
  medName:          { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  medDetails:       { fontSize: 14, color: colors.textSecondary, marginBottom: 10 },
  dueCard:          { marginBottom: 15, backgroundColor: '#fff3e0' },
  actionButtons:    { flexDirection: 'row', gap: 10 },
  takenButton:      { flex: 1, backgroundColor: '#4caf50', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  takenButtonText:  { color: '#fff', fontWeight: 'bold' },
  notTakenButton:   { flex: 1, backgroundColor: '#fff', borderWidth: 2, borderColor: '#f44336', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  notTakenButtonText:{ color: '#f44336', fontWeight: 'bold' },
  statusBadge:      { marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start' },
  doctorNote:       { fontSize: 11, color: '#7f8c8d', marginTop: 6, fontStyle: 'italic' },
});