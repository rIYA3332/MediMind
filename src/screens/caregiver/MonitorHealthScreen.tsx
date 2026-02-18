import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator
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

const MonitorHealthScreen = ({ route }: any) => {
  const { elderId, elderName } = route.params || {};
  const [activeTab, setActiveTab] = useState<'vitals' | 'meds'>('vitals');
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (elderId) {
      fetchHealthData();
    }
  }, [elderId, activeTab]);

  const fetchHealthData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'vitals') {
        const res = await fetch(getApiUrl(`/api/health-logs/${elderId}`));
        const data = await res.json();
        setHealthLogs(data);
      } else {
        const res = await fetch(getApiUrl(`/api/medications/${elderId}`));
        const data = await res.json();
        setMedications(data);
      }
    } catch (e) {
      console.log('Fetch error', e);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getHealthIcon = (type: string) => {
    const icons: Record<string, string> = {
      blood_pressure: '💉',
      blood_sugar: '🩸',
      weight: '⚖️',
      temperature: '🌡️',
      heart_rate: '❤️',
    };
    return icons[type] || '📊';
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {elderName ? `Monitoring: ${elderName}` : 'Health Monitor'}
        </Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'vitals' && styles.activeTab]}
          onPress={() => setActiveTab('vitals')}
        >
          <Text
            style={[styles.tabText, activeTab === 'vitals' && styles.activeTabText]}
          >
            Vitals
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'meds' && styles.activeTab]}
          onPress={() => setActiveTab('meds')}
        >
          <Text
            style={[styles.tabText, activeTab === 'meds' && styles.activeTabText]}
          >
            Medications
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.content}>
          {activeTab === 'vitals' ? (
            healthLogs.length === 0 ? (
              <Card>
                <Text style={styles.emptyText}>No health logs recorded yet</Text>
              </Card>
            ) : (
              healthLogs.map((log) => (
                <Card key={log.id} style={styles.logCard}>
                  <View style={styles.logHeader}>
                    <Text style={styles.logIcon}>{getHealthIcon(log.log_type)}</Text>
                    <View style={styles.logInfo}>
                      <Text style={styles.logType}>
                        {log.log_type.replace('_', ' ').toUpperCase()}
                      </Text>
                      <Text style={styles.logDate}>{formatDate(log.logged_at)}</Text>
                    </View>
                    <Text style={styles.logValue}>
                      {log.value} {log.unit}
                    </Text>
                  </View>
                  {log.notes && (
                    <Text style={styles.logNotes}>💬 {log.notes}</Text>
                  )}
                </Card>
              ))
            )
          ) : medications.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No medications recorded yet</Text>
            </Card>
          ) : (
            medications.map((med) => (
              <Card key={med.id} style={styles.medCard}>
                <View style={styles.medHeader}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medDosage}>{med.dosage}</Text>
                </View>
                <Text style={styles.medDetail}>
                  📅 {med.frequency} at {med.time}
                </Text>
              </Card>
            ))
          )}
        </ScrollView>
      )}
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
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  activeTabText: { color: colors.primary },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1, padding: 15 },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
  },
  logCard: { marginBottom: 12 },
  logHeader: { flexDirection: 'row', alignItems: 'center' },
  logIcon: { fontSize: 32, marginRight: 12 },
  logInfo: { flex: 1 },
  logType: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  logDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
  },
  logNotes: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  medCard: { marginBottom: 12 },
  medHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  medName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  medDosage: {
    backgroundColor: colors.primary,
    color: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 'bold',
  },
  medDetail: { fontSize: 13, color: colors.textSecondary },
});

export default MonitorHealthScreen;