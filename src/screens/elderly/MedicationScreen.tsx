import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
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
    if (userId) {
      fetchMedications();
    }
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

  const handleMarkTaken = async (medication: Medication) => {
    try {
      const res = await fetch(getApiUrl('/api/medications/mark-taken'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId: medication.id,
          userId,
          status: 'taken',
        }),
      });

      if (res.ok) {
        Alert.alert('✓ Done', `${medication.name} marked as taken`);
        fetchMedications();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to mark medication');
    }
  };

  const handleSkip = async (medication: Medication) => {
    Alert.alert(
      'Skip Medication',
      `Are you sure you want to skip ${medication.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(getApiUrl('/api/medications/mark-taken'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  medicationId: medication.id,
                  userId,
                  status: 'skipped',
                }),
              });

              if (res.ok) {
                Alert.alert('Skipped', `${medication.name} has been skipped`);
                fetchMedications();
              }
            } catch (e) {
              Alert.alert('Error', 'Failed to skip medication');
            }
          },
        },
      ]
    );
  };

  const getTimingLabel = (t: string) => {
    const labels: any = {
      after_eat: 'After eat',
      while_eating: 'While eating',
      before_eat: 'Before eat',
      night: 'Night'
    };
    return labels[t] || t;
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
    
    if (minutesLeft < -30) return { label: 'Overdue', color: '#f44336', textColor: '#fff' };
    if (minutesLeft < 0) return { label: 'Due Now', color: '#ff9800', textColor: '#fff' };
    if (minutesLeft < 60) return { label: 'Upcoming', color: '#2196f3', textColor: '#fff' };
    return { label: 'Pending', color: '#e0e0e0', textColor: '#666' };
  };

  // Separate medications
  const dueNow = medications.filter(med => {
    const status = getDueStatus(med.time, med.taken_today);
    return status.label === 'Due Now' && !med.taken_today;
  });

  const upcoming = medications.filter(med => {
    const status = getDueStatus(med.time, med.taken_today);
    return status.label === 'Upcoming' && !med.taken_today;
  });

  const todaySchedule = medications.filter(med => {
    const status = getDueStatus(med.time, med.taken_today);
    return status.label !== 'Due Now' && status.label !== 'Upcoming';
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
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : medications.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>
              No medications scheduled yet.{'\n'}
              Your caregiver will add them for you.
            </Text>
          </Card>
        ) : (
          <>
            {/* Due Now Section */}
            {dueNow.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>⏰ Due Now</Text>
                {dueNow.map((med) => (
                  <Card key={med.id} style={styles.dueCard}>
                    <View style={styles.medHeader}>
                      <View style={styles.medIconContainer}>
                        <Text style={styles.medIcon}>💊</Text>
                      </View>
                      <View style={styles.medInfo}>
                        <Text style={styles.medName}>{med.name}</Text>
                        <Text style={styles.medDetails}>
                          Take {med.dosage}
                        </Text>
                        <Text style={styles.medTiming}>
                          {med.time} • {getTimingLabel(med.timing)}
                        </Text>
                      </View>
                    </View>
                    
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        style={styles.takenButton}
                        onPress={() => handleMarkTaken(med)}
                      >
                        <Text style={styles.takenButtonText}>✓ Mark Taken</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={styles.skipButton}
                        onPress={() => handleSkip(med)}
                      >
                        <Text style={styles.skipButtonText}>Skip</Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                ))}
              </>
            )}

            {/* Upcoming Section */}
            {upcoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>🔜 Upcoming</Text>
                {upcoming.map((med) => (
                  <Card key={med.id} style={styles.upcomingCard}>
                    <View style={styles.medRow}>
                      <View style={styles.medIconSmall}>
                        <Text style={styles.medIconText}>💊</Text>
                      </View>
                      <View style={styles.medInfo}>
                        <Text style={styles.medName}>{med.name}</Text>
                        <Text style={styles.medDetails}>
                          {med.dosage} • {med.time}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: '#2196f3' }]}>
                        <Text style={styles.statusText}>Upcoming</Text>
                      </View>
                    </View>
                  </Card>
                ))}
              </>
            )}

            {/* Today's Schedule */}
            <Text style={styles.sectionTitle}>📅 Today's Schedule</Text>
            {todaySchedule.map((med) => {
              const status = getDueStatus(med.time, med.taken_today);
              return (
                <Card key={med.id} style={styles.medCard}>
                  <View style={styles.medRow}>
                    <View style={styles.medIconSmall}>
                      <Text style={styles.medIconText}>
                        {med.taken_today > 0 ? '✓' : '💊'}
                      </Text>
                    </View>
                    <View style={styles.medInfo}>
                      <Text style={[
                        styles.medName,
                        med.taken_today > 0 && styles.medNameTaken
                      ]}>
                        {med.name}
                      </Text>
                      <Text style={styles.medDetails}>
                        {med.dosage} • {med.time} • {getTimingLabel(med.timing)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: status.color },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: status.textColor }]}>
                        {status.label}
                      </Text>
                    </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 12,
    marginTop: 10,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    paddingVertical: 30,
  },
  dueCard: {
    marginBottom: 15,
    backgroundColor: '#fff3e0',
    borderLeftWidth: 5,
    borderLeftColor: '#ff9800',
    elevation: 3,
  },
  upcomingCard: {
    marginBottom: 12,
    backgroundColor: '#e3f2fd',
    borderLeftWidth: 4,
    borderLeftColor: '#2196f3',
  },
  medCard: {
    marginBottom: 12,
  },
  medHeader: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  medIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
    elevation: 2,
  },
  medIcon: { fontSize: 30 },
  medIconSmall: {
    width: 45,
    height: 45,
    borderRadius: 22,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  medIconText: { fontSize: 24 },
  medInfo: { flex: 1 },
  medName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  medNameTaken: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  medDetails: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  medTiming: {
    fontSize: 13,
    color: '#ff9800',
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  statusText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: 'bold',
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
    elevation: 2,
  },
  takenButtonText: {
    color: colors.white,
    fontWeight: 'bold',
    fontSize: 15,
  },
  skipButton: {
    flex: 1,
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  skipButtonText: {
    color: colors.textPrimary,
    fontWeight: 'bold',
    fontSize: 15,
  },
});

export default MedicationScreen;