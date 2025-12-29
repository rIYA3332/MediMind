import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../styles/colors';

const MedicationScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text>Medication Screen</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
});

export default MedicationScreen;
