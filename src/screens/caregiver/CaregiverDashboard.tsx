import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { colors } from '../../styles/colors';
import { useAuth } from '../../context/AuthContext';
import { getApiUrl } from '../../config/api';

interface Elder {
  id: number;
  name: string;
  dob: string;
  phone: string;
  emergency_contact: string;
  relationship: string;
}

const CaregiverDashboard = () => {
  const { user } = useAuth();
  const [assignedElders, setAssignedElders] = useState<Elder[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    fetch(getApiUrl(`/api/connections/${user.id}`))
      .then(res => res.json())
      .then(data => setAssignedElders(Array.isArray(data) ? data : []))
      .catch(err => console.log('Error fetching elders:', err));
  }, [user]);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Caregiver Dashboard</Text>

      {assignedElders.length === 0 ? (
        <Text style={styles.emptyText}>No assigned elders yet.</Text>
      ) : (
        <FlatList
          data={assignedElders}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.elderCard}>
              <Text style={styles.elderName}>{item.name}</Text>
              <Text>Relationship: {item.relationship || 'N/A'}</Text>
              <Text>Phone: {item.phone}</Text>
              <Text>DOB: {new Date(item.dob).toLocaleDateString()}</Text>
              <Text>Emergency: {item.emergency_contact}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  header: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  emptyText: { textAlign: 'center', color: colors.textSecondary },
  elderCard: {
    backgroundColor: colors.white,
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  elderName: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
});

export default CaregiverDashboard;
