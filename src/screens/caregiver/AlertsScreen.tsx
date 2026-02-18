import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';

const AlertsScreen: React.FC = () => {
  // Placeholder alerts
  const alerts = [
    {
      id: 1,
      type: 'medication',
      message: 'John missed morning medication',
      time: '2 hours ago',
      priority: 'high',
    },
    {
      id: 2,
      type: 'vital',
      message: 'Blood pressure reading is elevated',
      time: '5 hours ago',
      priority: 'medium',
    },
  ];

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'medication': return '💊';
      case 'vital': return '⚠️';
      case 'emergency': return '🚨';
      default: return '🔔';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return '#ff7675';
      case 'medium': return '#fdcb6e';
      case 'low': return '#74b9ff';
      default: return colors.textSecondary;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alerts & Notifications</Text>
      </View>

      <ScrollView style={styles.content}>
        {alerts.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>No alerts at this time</Text>
          </Card>
        ) : (
          alerts.map((alert) => (
            <Card
              key={alert.id}
              style={[
                styles.alertCard,
                { borderLeftColor: getPriorityColor(alert.priority) },
              ]}
            >
              <View style={styles.alertHeader}>
                <Text style={styles.alertIcon}>{getAlertIcon(alert.type)}</Text>
                <View style={styles.alertInfo}>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  <Text style={styles.alertTime}>{alert.time}</Text>
                </View>
              </View>
            </Card>
          ))
        )}

        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            💡 Alerts will appear here when elders miss medications or have
            concerning vital readings
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
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  content: { flex: 1, padding: 15 },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
  },
  alertCard: {
    marginBottom: 12,
    borderLeftWidth: 5,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertIcon: { fontSize: 32, marginRight: 12 },
  alertInfo: { flex: 1 },
  alertMessage: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  alertTime: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
  },
  infoCard: {
    marginTop: 10,
    backgroundColor: '#e8f6ef',
  },
  infoText: {
    fontSize: 12,
    color: '#27ae60',
    lineHeight: 18,
  },
});

export default AlertsScreen;