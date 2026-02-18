import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';

const ElderlyDashboard = ({ route, navigation }: any) => {
  const { user } = route.params;
  const [requests, setRequests] = useState([]);
  const [nextMed, setNextMed] = useState<any>(null);
  const [summary, setSummary] = useState({
    medications: { taken: 0, total: 0 },
    healthLogs: 0,
    moodRecorded: false
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    saveUserToStorage();
    loadDashboardData();
  }, []);

  const saveUserToStorage = async () => {
    await AsyncStorage.setItem('user', JSON.stringify(user));
  };

  const loadDashboardData = async () => {
    await fetchRequests();
    await fetchNextMedication();
    await fetchTodaySummary();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch(getApiUrl(`/api/auth/pending/${user.id}`));
      const data = await res.json();
      setRequests(data);
    } catch (e) {
      console.log("Fetch error", e);
    }
  };

  const fetchNextMedication = async () => {
    try {
      const res = await fetch(getApiUrl(`/api/medications/today/${user.id}`));
      const medications = await res.json();
      
      if (medications.length > 0) {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        
        // Find next medication that hasn't been taken today
        const upcoming = medications.find((med: any) => {
          const [hours, minutes] = med.time.split(':');
          const medTime = parseInt(hours) * 60 + parseInt(minutes);
          return medTime >= currentTime && !med.taken_today;
        });
        
        setNextMed(upcoming || null);
      }
    } catch (e) {
      console.log("Fetch medications error", e);
    }
  };

// new
  const fetchTodaySummary = async () => {
  if (!user?.id) return;

  try {
    const response = await fetch(getApiUrl(`/api/mood/${user.id}`));
    const moodLogs = await response.json();

    const now = new Date();

    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );

    const todayMood = moodLogs.filter((log: any) => {
      const logDate = new Date(log.logged_at);
      return logDate >= startOfDay && logDate < endOfDay;
    });

    setSummary(prev => ({
      ...prev,
      moodRecorded: todayMood.length > 0
    }));

  } catch (error) {
    console.error('Error fetching mood:', error);
  }
};


  const handleAction = async (connectionId: number, status: 'approved' | 'rejected') => {
    try {
      const endpoint = status === 'approved' ? 'approve-connection' : 'reject-connection';
      const res = await fetch(getApiUrl(`/api/auth/${endpoint}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      
      if (res.ok) {
        Alert.alert("Success", `Request ${status}`);
        fetchRequests();
      }
    } catch (e) {
      Alert.alert("Error", "Action failed");
    }
  };

  const calculateTimeUntil = (time: string) => {
    const now = new Date();
    const [hours, minutes] = time.split(':');
    const medTime = new Date();
    medTime.setHours(parseInt(hours), parseInt(minutes), 0);
    
    const diff = medTime.getTime() - now.getTime();
    const minutesLeft = Math.floor(diff / 60000);
    
    if (minutesLeft < 0) return 'Now';
    if (minutesLeft < 30) return `in ${minutesLeft} min`;
    return `at ${time}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good Morning</Text>
            <Text style={styles.userName}>{user.name}</Text>
          </View>
          <TouchableOpacity 
            onPress={() => navigation.replace('Login')} 
            style={styles.menuButton}
          >
            <Text style={styles.menuText}>☰</Text>
          </TouchableOpacity>
        </View>

        {/* Next Medication Card */}
        {nextMed && (
          <Card style={styles.nextMedCard}>
            <View style={styles.medHeader}>
              <Text style={styles.medLabel}>⏰ Next Medication</Text>
            </View>
            <Text style={styles.medName}>{nextMed.name} {nextMed.dosage}</Text>
            <Text style={styles.medTime}>
              Due {calculateTimeUntil(nextMed.time)} • {nextMed.timing?.replace('_', ' ')}
            </Text>
          </Card>
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => navigation.navigate('Health')}
          >
            <View style={styles.actionIconContainer}>
              <Text style={styles.actionIcon}>📊</Text>
            </View>
            <Text style={styles.actionText}>Log Health Data</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => navigation.navigate('MoodCheck')}
          >
            <View style={styles.actionIconContainer}>
              <Text style={styles.actionIcon}>😊</Text>
            </View>
            <Text style={styles.actionText}>Mood Check-in</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => navigation.navigate('Meds')}
          >
            <View style={styles.actionIconContainer}>
              <Text style={styles.actionIcon}>💊</Text>
            </View>
            <Text style={styles.actionText}>View Medications</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => Alert.alert('Recommendations', 'Feature coming soon!')}
          >
            <View style={styles.actionIconContainer}>
              <Text style={styles.actionIcon}>💡</Text>
            </View>
            <Text style={styles.actionText}>Recommendations</Text>
          </TouchableOpacity>
        </View>

        {/* Today's Summary */}
        <Text style={styles.sectionTitle}>Today's Summary</Text>
        <Card>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryIcon}>💊</Text>
            <View style={styles.summaryInfo}>
              <Text style={styles.summaryLabel}>Medications</Text>
              <Text style={styles.summaryValue}>
                {summary.medications.taken}/{summary.medications.total} taken
              </Text>
            </View>
            <Text style={[
              styles.summaryStatus,
              summary.medications.taken === summary.medications.total && summary.medications.total > 0
                ? styles.statusGreen : styles.statusOrange
            ]}>
              {summary.medications.taken === summary.medications.total && summary.medications.total > 0
                ? 'On Track' : 'Pending'}
            </Text>
          </View>
          
          <View style={styles.summaryRow}>
            <Text style={styles.summaryIcon}>📊</Text>
            <View style={styles.summaryInfo}>
              <Text style={styles.summaryLabel}>Health Logs</Text>
              <Text style={styles.summaryValue}>
                {summary.healthLogs} {summary.healthLogs === 1 ? 'entry' : 'entries'}
              </Text>
            </View>
            <Text style={[
              styles.summaryStatus,
              summary.healthLogs > 0 ? styles.statusGreen : styles.statusGray
            ]}>
              {summary.healthLogs > 0 ? 'Active' : 'None'}
            </Text>
          </View>
          
          <View style={styles.summaryRow}>
            <Text style={styles.summaryIcon}>😊</Text>
            <View style={styles.summaryInfo}>
              <Text style={styles.summaryLabel}>Mood</Text>
              <Text style={styles.summaryValue}>
                {summary.moodRecorded ? 'Recorded' : 'Not recorded'}
              </Text>
            </View>
            <Text style={[
              styles.summaryStatus,
              summary.moodRecorded ? styles.statusGreen : styles.statusOrange
            ]}>
              {summary.moodRecorded ? 'Done' : 'Monitor'}
            </Text>
          </View>
        </Card>

        {/* Connection Requests */}
        {requests.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Pending Requests</Text>
            {requests.map((req: any) => (
              <Card key={req.connectionId} style={styles.requestCard}>
                <View style={styles.reqHeader}>
                  <Text style={styles.reqName}>{req.name}</Text>
                  <Text style={styles.reqRole}>{req.role.toUpperCase()}</Text>
                </View>
                <Text style={styles.reqRelation}>
                  {req.relationship || 'Family member'} wants to monitor your health
                </Text>
                
                <View style={styles.btnRow}>
                  <TouchableOpacity 
                    style={styles.approveBtn}
                    onPress={() => handleAction(req.connectionId, 'approved')}
                  >
                    <Text style={styles.approveBtnText}>✓ Approve</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.rejectBtn}
                    onPress={() => handleAction(req.connectionId, 'rejected')}
                  >
                    <Text style={styles.rejectBtnText}>✕ Reject</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))}
          </>
        )}

        {/* Registration Code */}
        <Card style={styles.codeCard}>
          <Text style={styles.codeLabel}>Your Connection Code</Text>
          <Text style={styles.codeValue}>{user.code}</Text>
          <Text style={styles.codeHint}>Share with family or doctor to get started</Text>
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
    paddingBottom: 15,
  },
  greeting: { fontSize: 14, color: colors.textSecondary },
  userName: { fontSize: 26, fontWeight: 'bold', color: colors.primary, marginTop: 2 },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
  },
  menuText: { fontSize: 22, color: colors.textPrimary },
  nextMedCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#e8f4ff',
    borderLeftWidth: 5,
    borderLeftColor: colors.primary,
    elevation: 3,
  },
  medHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  medLabel: { fontSize: 13, color: '#1976d2', fontWeight: '700' },
  medName: { fontSize: 20, fontWeight: 'bold', color: colors.textPrimary },
  medTime: { fontSize: 15, color: colors.primary, marginTop: 6, fontWeight: '500' },
  sectionTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginHorizontal: 20,
    marginBottom: 12,
    marginTop: 5,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 20,
  },
  actionCard: {
    width: '48%',
    backgroundColor: colors.white,
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
  },
  actionIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionIcon: { fontSize: 28 },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  summaryIcon: { fontSize: 26, marginRight: 15, width: 30 },
  summaryInfo: { flex: 1 },
  summaryLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 3 },
  summaryValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  summaryStatus: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusGreen: { backgroundColor: '#d4edda', color: '#155724' },
  statusOrange: { backgroundColor: '#fff3cd', color: '#856404' },
  statusGray: { backgroundColor: '#e9ecef', color: '#6c757d' },
  requestCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
    backgroundColor: '#fff8e1',
  },
  reqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reqName: { fontSize: 17, fontWeight: 'bold', color: colors.textPrimary },
  reqRole: {
    fontSize: 10,
    backgroundColor: '#ff9800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    color: colors.white,
    fontWeight: 'bold',
  },
  reqRelation: { fontSize: 14, color: colors.textSecondary, marginBottom: 15 },
  btnRow: { flexDirection: 'row', gap: 10 },
  approveBtn: {
    flex: 1,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  approveBtnText: { color: colors.white, fontWeight: 'bold', fontSize: 15 },
  rejectBtn: {
    flex: 1,
    height: 44,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectBtnText: { color: colors.textPrimary, fontWeight: 'bold', fontSize: 15 },
  codeCard: {
    marginHorizontal: 20,
    marginBottom: 30,
    marginTop: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingVertical: 25,
    elevation: 4,
  },
  codeLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '500',
  },
  codeValue: {
    color: colors.white,
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 4,
    marginBottom: 8,
  },
  codeHint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

export default ElderlyDashboard;