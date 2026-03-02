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

interface Medication {
  id: number;
  name: string;
  dosage: string;
  frequency: string;
  time: string;
  days: string[];
  timing: string;
  taken_today: number;
}

const MedicationScreen: React.FC = () => {
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (userId) fetchMedications();
  }, [userId]);

  const loadUser = async () => {
    const user = await AsyncStorage.getItem('user');
    if (user) {
      const userData = JSON.parse(user);
      setUserId(userData.id);
    }
  };

  const fetchMedications = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/api/medications/today/${userId}`));
      const data = await res.json();
      setMedications(data);
    } catch (e) {
      console.log('Fetch error', e);
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId: medication.id,
          userId,
          status,
        }),
      });

      if (res.ok) {
        Alert.alert(
          status === 'taken' ? '✅ Taken' : '❌ Not Taken',
          `${medication.name} updated`
        );
        fetchMedications();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update medication');
    }
  };

  const getDueStatus = (medTime: string, takenToday: number) => {
    if (takenToday > 0) {
      return { label: '✓ Taken', color: '#4caf50', textColor: '#fff' };
    }

    const now = new Date();
    const [hours, minutes] = medTime.split(':');
    const medDate = new Date();
    medDate.setHours(parseInt(hours), parseInt(minutes), 0);

    const diff = medDate.getTime() - now.getTime();
    const minutesLeft = Math.floor(diff / 60000);

    if (minutesLeft < -30)
      return { label: 'Overdue', color: '#f44336', textColor: '#fff' };
    if (minutesLeft < 0)
      return { label: 'Due Now', color: '#ff9800', textColor: '#fff' };
    if (minutesLeft < 60)
      return { label: 'Upcoming', color: '#2196f3', textColor: '#fff' };

    return { label: 'Pending', color: '#e0e0e0', textColor: '#666' };
  };

  const dueNow = medications.filter(
    med => getDueStatus(med.time, med.taken_today).label === 'Due Now'
  );

  const upcoming = medications.filter(
    med => getDueStatus(med.time, med.taken_today).label === 'Upcoming'
  );

  const todaySchedule = medications.filter(med => {
    const label = getDueStatus(med.time, med.taken_today).label;
    return label !== 'Due Now' && label !== 'Upcoming';
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Medications</Text>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : medications.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>
              No medications scheduled yet.
            </Text>
          </Card>
        ) : (
          <>
            {dueNow.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>⏰ Due Now</Text>
                {dueNow.map(med => (
                  <Card key={med.id} style={styles.dueCard}>
                    <Text style={styles.medName}>{med.name}</Text>
                    <Text style={styles.medDetails}>
                      {med.dosage} • {med.time}
                    </Text>

                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        style={styles.takenButton}
                        onPress={() => updateStatus(med, 'taken')}
                      >
                        <Text style={styles.takenButtonText}>✅ Taken</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.notTakenButton}
                        onPress={() => updateStatus(med, 'skipped')}
                      >
                        <Text style={styles.notTakenButtonText}>
                          ❌ Not Taken
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))}
              </>
            )}

            {upcoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>🔜 Upcoming</Text>
                {upcoming.map(med => (
                  <Card key={med.id}>
                    <Text style={styles.medName}>{med.name}</Text>
                    <Text style={styles.medDetails}>
                      {med.dosage} • {med.time}
                    </Text>
                  </Card>
                ))}
              </>
            )}

            <Text style={styles.sectionTitle}>📅 Today</Text>
            {todaySchedule.map(med => {
              const status = getDueStatus(med.time, med.taken_today);
              return (
                <Card key={med.id}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medDetails}>
                    {med.dosage} • {med.time}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: status.color },
                    ]}
                  >
                    <Text style={{ color: status.textColor }}>
                      {status.label}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default MedicationScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: 20,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  content: { flex: 1, padding: 15 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginVertical: 10,
  },
  emptyText: {
    textAlign: 'center',
    padding: 20,
    color: colors.textSecondary,
  },
  medName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  medDetails: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  dueCard: {
    marginBottom: 15,
    backgroundColor: '#fff3e0',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  takenButton: {
    flex: 1,
    backgroundColor: '#4caf50',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  takenButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  notTakenButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f44336',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  notTakenButtonText: {
    color: '#f44336',
    fontWeight: 'bold',
  },
  statusBadge: {
    marginTop: 8,
    padding: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
});