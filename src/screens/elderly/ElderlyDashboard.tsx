import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ScrollView, StatusBar } from 'react-native';
import Button from '../../components/Button';
import { colors } from '../../styles/colors';

const ElderlyDashboard = ({ route, navigation }: any) => {
  const { user } = route.params; 
  const [requests, setRequests] = useState([]);

  const fetchRequests = async () => {
    try {
      const res = await fetch(`http://10.125.81.28:3000/api/auth/pending/${user.id}`);
      const data = await res.json();
      setRequests(data);
    } catch (e) { console.log("Fetch error", e); }
  };

  useEffect(() => { fetchRequests(); }, []);

  const handleAction = async (connectionId: number, status: 'approved' | 'rejected') => {
    try {
      const endpoint = status === 'approved' ? 'approve-connection' : 'reject-connection';
      const res = await fetch(`http://10.125.81.28:3000/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      if (res.ok) {
        Alert.alert("Success", `Request ${status}`);
        fetchRequests();
      }
    } catch (e) { Alert.alert("Error", "Action failed"); }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        {/* Header Section */}
        <View style={styles.header}>
          <View>
            <Text style={styles.welcomeText}>Welcome,</Text>
            <Text style={styles.userName}>{user.name}!</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.replace('Login')} style={styles.logoutBtn}>
            <Text style={styles.logoutTxt}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Your Personal Connection Code</Text>
          <Text style={styles.codeValue}>{user.code}</Text>
          <Text style={styles.codeHint}>Share this with your caregiver or doctor</Text>
        </View>

        <Text style={styles.sectionTitle}>Pending Requests</Text>
        
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
          {requests.map((req: any) => (
            <View key={req.connectionId} style={styles.notificationCard}>
              <View style={styles.reqHeader}>
                <Text style={styles.reqName}>{req.name}</Text>
                <Text style={styles.reqRole}>{req.role.toUpperCase()}</Text>
              </View>
              <Text style={styles.reqSub}>wants to monitor your health activities.</Text>
              
              <View style={styles.btnRow}>
                <Button 
                  title="Approve" 
                  onPress={() => handleAction(req.connectionId, 'approved')} 
                  style={styles.approveBtn} 
                />
                <Button 
                  title="Reject" 
                  variant="secondary" 
                  onPress={() => handleAction(req.connectionId, 'rejected')} 
                  style={styles.rejectBtn} 
                />
              </View>
            </View>
          ))}

          {requests.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No new connection requests at the moment.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8f9fa' },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  welcomeText: { fontSize: 16, color: '#7f8c8d' },
  userName: { fontSize: 24, fontWeight: 'bold', color: colors.primary },
  logoutBtn: { paddingVertical: 8, paddingHorizontal: 15, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#ff7675' },
  logoutTxt: { color: '#ff7675', fontWeight: 'bold' },
  codeCard: { backgroundColor: colors.primary, padding: 20, borderRadius: 15, marginBottom: 30, elevation: 4 },
  codeLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center' },
  codeValue: { color: '#fff', fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginVertical: 5, letterSpacing: 2 },
  codeHint: { color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#2d3436', marginBottom: 15 },
  notificationCard: { backgroundColor: '#fff', padding: 20, borderRadius: 15, marginBottom: 15, borderLeftWidth: 5, borderLeftColor: colors.primary, elevation: 2 },
  reqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  reqName: { fontSize: 18, fontWeight: 'bold', color: '#2d3436' },
  reqRole: { fontSize: 10, backgroundColor: '#dfe6e9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5, color: '#636e72', fontWeight: 'bold' },
  reqSub: { fontSize: 13, color: '#636e72', marginBottom: 15 },
  btnRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, height: 45, borderRadius: 8 },
  rejectBtn: { flex: 1, height: 45, borderRadius: 8, backgroundColor: '#fff', borderColor: '#dfe6e9' },
  emptyBox: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: '#b2bec3', fontSize: 14 }
});

export default ElderlyDashboard;