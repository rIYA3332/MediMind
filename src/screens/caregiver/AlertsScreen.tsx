import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
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
}

const AlertsScreen: React.FC = () => {
  const [caregiverId, setCaregiverId] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadCaregiverId();
  }, []);

  useEffect(() => {
    if (caregiverId) {
      fetchAlerts();
    }
  }, [caregiverId]);

  const loadCaregiverId = async () => {
    try {
      const user = await AsyncStorage.getItem('user');
      if (user) {
        const userData = JSON.parse(user);
        console.log('Loaded user:', userData);
        setCaregiverId(userData.id);
      }
    } catch (e) {
      console.log('Error loading user:', e);
    }
  };

  const fetchAlerts = async () => {
    if (!caregiverId) return;
    
    setLoading(true);
    try {
      console.log('Fetching alerts for caregiver:', caregiverId);
      const res = await fetch(getApiUrl(`/api/alerts/caregiver/${caregiverId}`));
      const data = await res.json();
      
      console.log('Alerts response:', data);
      
      if (Array.isArray(data)) {
        // Sort by date, newest first
        const sortedAlerts = data.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setAlerts(sortedAlerts);
      } else {
        setAlerts([]);
      }
    } catch (e) {
      console.log('Failed to fetch alerts:', e);
      setAlerts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchAlerts();
  };

  const handleMarkAsRead = async (alertId: number) => {
    try {
      const res = await fetch(getApiUrl(`/api/alerts/${alertId}/read`), {
        method: 'PUT',
      });

      if (res.ok) {
        // Update local state
        setAlerts(prev => prev.filter(alert => alert.id !== alertId));
      }
    } catch (e) {
      console.log('Failed to mark alert as read:', e);
    }
  };

  const getAlertIcon = (type?: string) => {
    switch (type) {
      case 'medication': return '💊';
      case 'vital': return '⚠️';
      case 'emergency': return '🚨';
      case 'mood': return '😊';
      default: return '🔔';
    }
  };

  const getBorderColor = (type?: string) => {
    switch (type) {
      case 'emergency': return '#ff7675';
      case 'vital': return '#fdcb6e';
      case 'medication': return '#74b9ff';
      case 'mood': return '#a29bfe';
      default: return colors.textSecondary;
    }
  };

  const getAlertTypeLabel = (type?: string) => {
    switch (type) {
      case 'medication': return 'Medication';
      case 'vital': return 'Vital Signs';
      case 'emergency': return 'Emergency';
      case 'mood': return 'Mood Update';
      default: return 'Notification';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  if (!caregiverId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Alerts & Notifications</Text>
        </View>
        <Card style={{ margin: 15 }}>
          <Text style={styles.emptyText}>
            {loading ? 'Loading...' : 'Please log in as a caregiver to view alerts.'}
          </Text>
        </Card>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alerts & Notifications</Text>
        {alerts.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{alerts.length}</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {alerts.length > 0 ? (
          alerts.map((alert) => (
            <TouchableOpacity
              key={alert.id}
              activeOpacity={0.7}
              onPress={() => handleMarkAsRead(alert.id)}
            >
              <Card
                style={[
                  styles.alertCard,
                  { borderLeftColor: getBorderColor(alert.alert_type) }
                ]}
              >
                <View style={styles.alertHeader}>
                  <View style={styles.alertIconContainer}>
                    <Text style={styles.alertIcon}>
                      {getAlertIcon(alert.alert_type)}
                    </Text>
                  </View>
                  <View style={styles.alertInfo}>
                    <View style={styles.alertTopRow}>
                      <Text style={styles.alertType}>
                        {getAlertTypeLabel(alert.alert_type)}
                      </Text>
                      <Text style={styles.alertTime}>
                        {formatTimeAgo(alert.created_at)}
                      </Text>
                    </View>
                    {alert.elder_name && (
                      <Text style={styles.elderName}>
                        {alert.elder_name}
                      </Text>
                    )}
                    <Text style={styles.alertMessage}>{alert.message}</Text>
                  </View>
                </View>
                <View style={styles.dismissHint}>
                  <Text style={styles.dismissText}>Tap to dismiss</Text>
                </View>
              </Card>
            </TouchableOpacity>
          ))
        ) : (
          <Card>
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🎉</Text>
              <Text style={styles.emptyTitle}>All caught up!</Text>
              <Text style={styles.emptyText}>
                No new alerts at this time. You'll be notified when your elders need attention.
              </Text>
            </View>
          </Card>
        )}

        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>💡 About Alerts</Text>
          <Text style={styles.infoText}>
            You'll receive notifications when:
          </Text>
          <Text style={styles.infoItem}>• Elders log their mood</Text>
          <Text style={styles.infoItem}>• Medications are missed</Text>
          <Text style={styles.infoItem}>• Vital signs are concerning</Text>
          <Text style={styles.infoItem}>• Emergency contacts are needed</Text>
          <Text style={styles.infoFooter}>
            Pull down to refresh alerts.
          </Text>
        </Card>
      </ScrollView>
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
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  badge: {
    backgroundColor: '#ff7675',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
  },
  badgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  content: { flex: 1, padding: 15 },
  alertCard: {
    marginBottom: 15,
    borderLeftWidth: 5,
    elevation: 2,
  },
  alertHeader: {
    flexDirection: 'row',
  },
  alertIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertIcon: { fontSize: 28 },
  alertInfo: { flex: 1 },
  alertTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertType: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  alertTime: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  elderName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  alertMessage: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  dismissHint: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  dismissText: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  infoCard: {
    marginTop: 10,
    marginBottom: 30,
    backgroundColor: '#e8f6ef',
    borderLeftWidth: 4,
    borderLeftColor: '#27ae60',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#27ae60',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#27ae60',
    marginBottom: 8,
  },
  infoItem: {
    fontSize: 12,
    color: '#27ae60',
    marginLeft: 8,
    marginBottom: 4,
  },
  infoFooter: {
    fontSize: 11,
    color: '#27ae60',
    fontStyle: 'italic',
    marginTop: 8,
  },
});

export default AlertsScreen;