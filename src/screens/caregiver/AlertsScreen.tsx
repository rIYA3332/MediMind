import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useIsFocused } from '@react-navigation/native';

interface Alert {
  id: number;
  alert_type: string;
  message: string;
  created_at: string;
}

const AlertsScreen: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const { user } = useAuth();
  const caregiverId = user?.id;
  const isFocused = useIsFocused();

  useEffect(() => {
    if (caregiverId && isFocused) fetchAlerts();
  }, [caregiverId, isFocused]);

  const fetchAlerts = async () => {
    if (!caregiverId) return;
    try {
      const res = await fetch(getApiUrl(`/api/alerts/caregiver/${caregiverId}`));
      const data = await res.json();
      setAlerts(Array.isArray(data) ? data : data.data || []);
    } catch (e) {
      console.log('Failed to fetch alerts', e);
      setAlerts([]);
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'medication': return '💊';
      case 'vital': return '⚠️';
      case 'emergency': return '🚨';
      case 'mood': return '😊';
      default: return '🔔';
    }
  };

  const getBorderColor = (type: string) => {
    switch (type) {
      case 'emergency': return '#ff7675';
      case 'vital': return '#fdcb6e';
      case 'medication': return '#74b9ff';
      case 'mood': return '#74b9ff';
      default: return colors.textSecondary;
    }
  };

  if (!caregiverId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Alerts & Notifications</Text>
        </View>
        <Card style={{ margin: 15 }}>
          <Text style={styles.emptyText}>No caregiver selected.</Text>
        </Card>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alerts & Notifications</Text>
      </View>

      <ScrollView style={styles.content}>
        {alerts.length > 0 ? (
          alerts.map((alert) => (
            <Card
              key={alert.id}
              style={[styles.alertCard, { borderLeftColor: getBorderColor(alert.alert_type) }]}
            >
              <View style={styles.alertHeader}>
                <Text style={styles.alertIcon}>{getAlertIcon(alert.alert_type)}</Text>
                <View style={styles.alertInfo}>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  <Text style={styles.alertTime}>{new Date(alert.created_at).toLocaleString()}</Text>
                </View>
              </View>
            </Card>
          ))
        ) : (
          <Card>
            <Text style={styles.emptyText}>No alerts at this time</Text>
          </Card>
        )}

        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            💡 Alerts will appear here when elders miss medications, have concerning vital readings, or log mood updates.
          </Text>
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
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary },
  content: { flex: 1, padding: 15 },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 14 },
  alertCard: { marginBottom: 12, borderLeftWidth: 5 },
  alertHeader: { flexDirection: 'row', alignItems: 'center' },
  alertIcon: { fontSize: 32, marginRight: 12 },
  alertInfo: { flex: 1 },
  alertMessage: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary },
  alertTime: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  infoCard: { marginTop: 10, backgroundColor: '#e8f6ef' },
  infoText: { fontSize: 12, color: '#27ae60', lineHeight: 18 },
});

export default AlertsScreen;
