import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface HealthSummary {
  log_type: string;
  total_logs: number;
  last_logged: string;
  avg_value: number;
}

interface HealthLog {
  id: number;
  log_type: string;
  value: string;
  unit: string;
  notes: string;
  logged_at: string;
}

const HealthStatusScreen = ({ route }: any) => {
  const { elderId, elderName } = route.params || {};
  const [summary, setSummary] = useState<HealthSummary[]>([]);
  const [recentLogs, setRecentLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (elderId) {
      fetchHealthData();
    }
  }, [elderId]);

  const fetchHealthData = async () => {
    setLoading(true);
    try {
      const [summaryRes, logsRes] = await Promise.all([
        fetch(getApiUrl(`/api/health-summary/${elderId}`)),
        fetch(getApiUrl(`/api/health-logs/${elderId}`))
      ]);
      
      const summaryData = await summaryRes.json();
      const logsData = await logsRes.json();
      
      setSummary(summaryData);
      setRecentLogs(logsData.slice(0, 10));
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

  const getHealthLabel = (type: string) => {
    return type.replace('_', ' ').split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 24) {
      return `${diffHours} hours ago`;
    }
    return date.toLocaleDateString();
  };

  const getStatusColor = (type: string, value: string) => {
    if (type === 'blood_pressure') {
      const [systolic] = value.split('/').map(Number);
      if (systolic < 90) return '#ff7675';
      if (systolic > 140) return '#fdcb6e';
      return '#00b894';
    }
    if (type === 'blood_sugar') {
      const sugar = parseFloat(value);
      if (sugar < 70) return '#ff7675';
      if (sugar > 180) return '#fdcb6e';
      return '#00b894';
    }
    return colors.primary;
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Health Status</Text>
        <Text style={styles.headerSubtitle}>{elderName}</Text>
      </View>

      <ScrollView style={styles.content}>
        <Card style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>📊 Weekly Summary</Text>
          {summary.length === 0 ? (
            <Text style={styles.emptyText}>No health data logged this week</Text>
          ) : (
            <View style={styles.summaryGrid}>
              {summary.map((item) => (
                <View key={item.log_type} style={styles.summaryItem}>
                  <Text style={styles.summaryIcon}>{getHealthIcon(item.log_type)}</Text>
                  <Text style={styles.summaryLabel}>{getHealthLabel(item.log_type)}</Text>
                  <Text style={styles.summaryCount}>{item.total_logs} logs</Text>
                  {item.avg_value && (
                    <Text style={styles.summaryAvg}>
                      Avg: {item.avg_value.toFixed(1)}
                    </Text>
                  )}
                  <Text style={styles.summaryDate}>
                    {formatDate(item.last_logged)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.logsCard}>
          <Text style={styles.sectionTitle}>📋 Recent Logs</Text>
          {recentLogs.length === 0 ? (
            <Text style={styles.emptyText}>No recent health logs</Text>
          ) : (
            recentLogs.map((log) => (
              <View key={log.id} style={styles.logItem}>
                <View style={styles.logHeader}>
                  <Text style={styles.logIcon}>{getHealthIcon(log.log_type)}</Text>
                  <View style={styles.logInfo}>
                    <Text style={styles.logType}>{getHealthLabel(log.log_type)}</Text>
                    <Text style={styles.logDate}>{formatDate(log.logged_at)}</Text>
                  </View>
                  <View style={[
                    styles.logValue,
                    { backgroundColor: getStatusColor(log.log_type, log.value) }
                  ]}>
                    <Text style={styles.logValueText}>
                      {log.value} {log.unit}
                    </Text>
                  </View>
                </View>
                {log.notes && (
                  <Text style={styles.logNotes}>💬 {log.notes}</Text>
                )}
              </View>
            ))
          )}
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
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1, padding: 15 },
  summaryCard: { marginBottom: 15 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryItem: {
    width: '48%',
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryIcon: { fontSize: 32, marginBottom: 8 },
  summaryLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  summaryCount: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  summaryAvg: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  summaryDate: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  logsCard: { marginBottom: 30 },
  logItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logIcon: { fontSize: 28, marginRight: 12 },
  logInfo: { flex: 1 },
  logType: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  logDate: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  logValue: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logValueText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.white,
  },
  logNotes: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
    marginLeft: 40,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: 20,
  },
});

export default HealthStatusScreen;