import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface WeeklyReport {
  medications: {
    total: number;
    taken: number;
  };
  healthLogs: Array<{
    log_type: string;
    count: number;
    avg_value: number;
    max_value: string;
    min_value: string;
  }>;
  mood: Array<{
    mood: string;
    count: number;
  }>;
  alerts: {
    alert_count: number;
  };
}

const WeeklyReportScreen = ({ route }: any) => {
  const { elderId, elderName } = route.params || {};
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (elderId) {
      fetchReport();
    }
  }, [elderId]);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/api/reports/weekly/${elderId}`));
      const data = await res.json();
      setReport(data);
    } catch (e) {
      console.log('Fetch error', e);
    } finally {
      setLoading(false);
    }
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

  const getMoodEmoji = (mood: string) => {
    const emojis: Record<string, string> = {
      happy: '😊',
      neutral: '😐',
      sad: '😢',
      anxious: '😰',
      tired: '😴',
      lonely: '🪑',
    };
    return emojis[mood] || '😐';
  };

  const getMedicationAdherence = () => {
    if (!report || !report.medications.total) return 0;
    return Math.round((report.medications.taken / report.medications.total) * 100);
  };

  const getAdherenceColor = (percentage: number) => {
    if (percentage >= 90) return '#00b894';
    if (percentage >= 70) return '#fdcb6e';
    return '#ff7675';
  };

  const getHealthLabel = (type: string) => {
    return type.replace('_', ' ').split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Weekly Report</Text>
        </View>
        <Card style={{ margin: 15 }}>
          <Text style={styles.emptyText}>No data available</Text>
        </Card>
      </SafeAreaView>
    );
  }

  const adherence = getMedicationAdherence();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📊 Weekly Report</Text>
        <Text style={styles.headerSubtitle}>{elderName}</Text>
        <Text style={styles.dateRange}>Last 7 Days</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Overall Score */}
        <Card style={[styles.scoreCard, { borderLeftColor: getAdherenceColor(adherence) }]}>
          <Text style={styles.scoreTitle}>Overall Health Score</Text>
          <Text style={[styles.scoreValue, { color: getAdherenceColor(adherence) }]}>
            {adherence}%
          </Text>
          <Text style={styles.scoreSubtitle}>
            {adherence >= 90 ? 'Excellent' : adherence >= 70 ? 'Good' : 'Needs Attention'}
          </Text>
        </Card>

        {/* Medication Adherence */}
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>💊 Medication Adherence</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total Doses:</Text>
            <Text style={styles.statValue}>{report.medications.total}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Taken:</Text>
            <Text style={[styles.statValue, { color: '#00b894' }]}>
              {report.medications.taken}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Missed:</Text>
            <Text style={[styles.statValue, { color: '#ff7675' }]}>
              {report.medications.total - report.medications.taken}
            </Text>
          </View>
          <View style={[styles.progressBar, { backgroundColor: '#e0e0e0' }]}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  width: `${adherence}%`,
                  backgroundColor: getAdherenceColor(adherence)
                }
              ]} 
            />
          </View>
        </Card>

        {/* Health Logs */}
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📊 Health Vitals</Text>
          {report.healthLogs.length === 0 ? (
            <Text style={styles.emptyText}>No health logs this week</Text>
          ) : (
            report.healthLogs.map((log) => (
              <View key={log.log_type} style={styles.vitalCard}>
                <View style={styles.vitalHeader}>
                  <Text style={styles.vitalIcon}>{getHealthIcon(log.log_type)}</Text>
                  <Text style={styles.vitalLabel}>{getHealthLabel(log.log_type)}</Text>
                </View>
                <View style={styles.vitalStats}>
                  <View style={styles.vitalStat}>
                    <Text style={styles.vitalStatLabel}>Logs</Text>
                    <Text style={styles.vitalStatValue}>{log.count}</Text>
                  </View>
                  {log.avg_value && (
                    <View style={styles.vitalStat}>
                      <Text style={styles.vitalStatLabel}>Average</Text>
                      <Text style={styles.vitalStatValue}>{log.avg_value.toFixed(1)}</Text>
                    </View>
                  )}
                  <View style={styles.vitalStat}>
                    <Text style={styles.vitalStatLabel}>Range</Text>
                    <Text style={styles.vitalStatValue}>
                      {log.min_value} - {log.max_value}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </Card>

        {/* Mood Tracking */}
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>😊 Emotional Well-being</Text>
          {report.mood.length === 0 ? (
            <Text style={styles.emptyText}>No mood data this week</Text>
          ) : (
            <View style={styles.moodGrid}>
              {report.mood.map((item) => (
                <View key={item.mood} style={styles.moodItem}>
                  <Text style={styles.moodEmoji}>{getMoodEmoji(item.mood)}</Text>
                  <Text style={styles.moodLabel}>
                    {item.mood.charAt(0).toUpperCase() + item.mood.slice(1)}
                  </Text>
                  <Text style={styles.moodCount}>{item.count}x</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Alerts */}
        <Card style={[styles.sectionCard, { marginBottom: 30 }]}>
          <Text style={styles.sectionTitle}>🔔 Alerts This Week</Text>
          <View style={styles.alertBox}>
            <Text style={styles.alertCount}>{report.alerts.alert_count}</Text>
            <Text style={styles.alertLabel}>
              {report.alerts.alert_count === 1 ? 'Alert Generated' : 'Alerts Generated'}
            </Text>
          </View>
        </Card>
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
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  dateRange: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 4,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1, padding: 15 },
  scoreCard: {
    alignItems: 'center',
    paddingVertical: 25,
    marginBottom: 15,
    borderLeftWidth: 5,
  },
  scoreTitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scoreValue: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  scoreSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  sectionCard: { marginBottom: 15 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  progressBar: {
    height: 10,
    borderRadius: 5,
    marginTop: 15,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  vitalCard: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  vitalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  vitalIcon: { fontSize: 24, marginRight: 10 },
  vitalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  vitalStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  vitalStat: { alignItems: 'center' },
  vitalStatLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  vitalStatValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.primary,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moodItem: {
    width: '30%',
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  moodEmoji: { fontSize: 32, marginBottom: 8 },
  moodLabel: {
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  moodCount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primary,
  },
  alertBox: {
    backgroundColor: colors.background,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  alertCount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 5,
  },
  alertLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: 20,
  },
});

export default WeeklyReportScreen;