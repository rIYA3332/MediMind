import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../styles/colors';

const CaregiverDashboard = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Caregiver Dashboard</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  text: { fontSize: 18, fontWeight: 'bold' },
});

export default CaregiverDashboard;
