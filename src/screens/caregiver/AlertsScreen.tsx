import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface Alert {
  id: number;
  alert_type: string;
  message: string;
  created_at: string;
  elder_name?: string;
  is_read: boolean;
  priority: string;
}

const FILTERS = ['All', 'Vital', 'Mood', 'Health Log', 'Medication'];

const AlertsScreen: React.FC = ({ navigation }: any) => {
  const [caregiverId, setCaregiverId] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadCaregiverId();
  }, []);

  useEffect(() => {
    if (caregiverId) fetchAlerts();
  }, [caregiverId, showHistory]);

  const loadCaregiverId = async () => {
    try {
      const user = await AsyncStorage.getItem('user');
      if (user) setCaregiverId(JSON.parse(user).id);
    } catch (e) {
      console.log('Error loading user:', e);
    }
  };

  const fetchAlerts = async () => {
    if (!caregiverId) return;
    setLoading(true);
    try {
      const endpoint = showHistory
        ? `/api/alerts/caregiver/${caregiverId}/all`
        : `/api/alerts/caregiver/${caregiverId}`;
      const res = await fetch(getApiUrl(endpoint));
      const data = await res.json();
      const sorted = Array.isArray(data)
        ? data.sort((a, b) => {
            const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
            const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
            if (pDiff !== 0) return pDiff;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          })
        : [];
      if (showHistory) setAllAlerts(sorted);
      else setAlerts(sorted);
    } catch (e) {
      console.log('Failed to fetch alerts:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleMarkAsRead = async (alertId: number) => {
    try {
      await fetch(getApiUrl(`/api/alerts/${alertId}/read`), { method: 'PUT' });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (e) {
      console.log('Failed to mark alert as read:', e);
    }
  };

  const handleMarkAllRead = async () => {
    if (!caregiverId) return;
    try {
      await fetch(getApiUrl(`/api/alerts/caregiver/${caregiverId}/read-all`), { method: 'PUT' });
      setAlerts([]);
    } catch (e) {
      console.log('Failed to mark all read:', e);
    }
  };

  const getFilteredAlerts = () => {
    const source = showHistory ? allAlerts : alerts;
    if (activeFilter === 'All') return source;
    const map: Record<string, string> = {
      'Vital': 'vital',
      'Mood': 'mood',
      'Health Log': 'health_log',
      'Medication': 'medication',
    };
    return source.filter(a => a.alert_type === map[activeFilter]);
  };

  const getAlertIcon = (type?: string) => {
    switch (type) {
      case 'vital': return '⚠️';
      case 'mood': return '😊';
      case 'health_log': return '📊';
      case 'medication': return '💊';
      case 'emergency': return '🚨';
      default: return '🔔';
    }
  };

  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case 'critical': return { borderColor: '#ff4757', bg: '#fff5f5' };
      case 'high': return { borderColor: '#ff7675', bg: '#fff9f9' };
      case 'medium': return { borderColor: '#fdcb6e', bg: '#fffdf5' };
      default: return { borderColor: '#74b9ff', bg: '#f5f9ff' };
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'critical': return { label: '🚨 CRITICAL', color: '#ff4757' };
      case 'high': return { label: '⚠️ HIGH', color: '#e17055' };
      case 'medium': return { label: '📌 MEDIUM', color: '#fdcb6e' };
      default: return { label: '💬 INFO', color: '#74b9ff' };
    }
  };

  const getAlertTypeLabel = (type?: string) => {
    switch (type) {
      case 'vital': return 'Vital Signs Alert';
      case 'mood': return 'Mood Update';
      case 'health_log': return 'Health Log';
      case 'medication': return 'Medication';
      case 'emergency': return 'Emergency';
      default: return 'Notification';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(dateString).toLocaleDateString();
  };

  const filtered = getFilteredAlerts();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🔔 Alerts</Text>
          {!showHistory && alerts.length > 0 && (
            <Text style={styles.headerSub}>{alerts.length} unread</Text>
          )}
        </View>
        <View style={styles.headerActions}>
          {!showHistory && alerts.length > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={handleMarkAllRead}>
              <Text style={styles.clearBtnText}>Clear All</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.historyBtn, showHistory && styles.historyBtnActive]}
            onPress={() => setShowHistory(!showHistory)}
          >
            <Text style={[styles.historyBtnText, showHistory && { color: colors.white }]}>
              {showHistory ? 'Unread' : 'History'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[styles.filterChipText, activeFilter === f && { color: colors.white }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} />}
        >
          {filtered.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>🎉</Text>
              <Text style={styles.emptyTitle}>All caught up!</Text>
              <Text style={styles.emptyText}>No alerts to show here.</Text>
            </Card>
          ) : (
            filtered.map((alert) => {
              const priorityStyle = getPriorityStyle(alert.priority);
              const priorityLabel = getPriorityLabel(alert.priority);
              return (
                <TouchableOpacity
                  key={alert.id}
                  activeOpacity={0.7}
                  onPress={() => !showHistory && handleMarkAsRead(alert.id)}
                >
                  <View style={[
                    styles.alertCard,
                    { borderLeftColor: priorityStyle.borderColor, backgroundColor: priorityStyle.bg }
                  ]}>
                    <View style={styles.alertTop}>
                      <View style={styles.alertIconContainer}>
                        <Text style={styles.alertIcon}>{getAlertIcon(alert.alert_type)}</Text>
                      </View>
                      <View style={styles.alertMeta}>
                        <View style={styles.alertMetaRow}>
                          <Text style={styles.alertType}>{getAlertTypeLabel(alert.alert_type)}</Text>
                          <Text style={[styles.priorityTag, { color: priorityLabel.color }]}>
                            {priorityLabel.label}
                          </Text>
                        </View>
                        {alert.elder_name && (
                          <Text style={styles.elderName}>👤 {alert.elder_name}</Text>
                        )}
                        <Text style={styles.alertTime}>{formatTimeAgo(alert.created_at)}</Text>
                      </View>
                    </View>
                    <Text style={styles.alertMessage}>{alert.message}</Text>
                    {!showHistory && (
                      <Text style={styles.dismissHint}>Tap to dismiss</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {/* Info card */}
          <Card style={styles.infoCard}>
            <Text style={styles.infoTitle}>💡 Alert Types</Text>
            <Text style={styles.infoItem}>🚨 Critical — Immediate attention required</Text>
            <Text style={styles.infoItem}>⚠️ High — Concerning health patterns</Text>
            <Text style={styles.infoItem}>📌 Medium — Worth monitoring</Text>
            <Text style={styles.infoItem}>💬 Info — Regular activity updates</Text>
            <Text style={styles.infoFooter}>Pull down to refresh</Text>
          </Card>
          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: colors.textPrimary },
  headerSub: { fontSize: 12, color: '#ff7675', marginTop: 2, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff7675',
  },
  clearBtnText: { fontSize: 12, color: '#ff7675', fontWeight: '600' },
  historyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  historyBtnActive: { backgroundColor: colors.primary },
  historyBtnText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  filterBar: {
    backgroundColor: colors.white,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 55,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    backgroundColor: colors.white,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  content: { flex: 1, padding: 15 },
  alertCard: {
    marginBottom: 12,
    borderRadius: 12,
    borderLeftWidth: 5,
    padding: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  alertTop: { flexDirection: 'row', marginBottom: 10 },
  alertIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertIcon: { fontSize: 24 },
  alertMeta: { flex: 1 },
  alertMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  alertType: { fontSize: 12, fontWeight: 'bold', color: colors.textPrimary, textTransform: 'uppercase' },
  priorityTag: { fontSize: 10, fontWeight: 'bold' },
  elderName: { fontSize: 13, fontWeight: '600', color: colors.primary, marginBottom: 2 },
  alertTime: { fontSize: 11, color: colors.textSecondary },
  alertMessage: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  dismissHint: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  emptyCard: { alignItems: 'center', paddingVertical: 50, marginTop: 20 },
  emptyIcon: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 8 },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  infoCard: {
    marginTop: 10,
    marginBottom: 10,
    backgroundColor: '#e8f6ef',
    borderLeftWidth: 4,
    borderLeftColor: '#27ae60',
  },
  infoTitle: { fontSize: 14, fontWeight: 'bold', color: '#27ae60', marginBottom: 10 },
  infoItem: { fontSize: 12, color: '#27ae60', marginBottom: 5, marginLeft: 4 },
  infoFooter: { fontSize: 11, color: '#27ae60', fontStyle: 'italic', marginTop: 8 },
});

export default AlertsScreen;