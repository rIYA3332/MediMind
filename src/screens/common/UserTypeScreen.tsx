import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { RootStackParamList } from '../../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'UserType'>;

const UserTypeScreen: React.FC<Props> = ({ navigation, route }) => {
  const { mode } = route.params;

  const handleSelectType = (role: 'elderly' | 'caregiver' | 'doctor') => {
    if (mode === 'register') {
      
      navigation.navigate('Register', { role });
    } else {
      
      navigation.navigate('Login');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Who are you?</Text>
        <Text style={styles.subtitle}>
          {mode === 'register' ? 'Select a role to create account' : 'Select your role to continue'}
        </Text>

        <TouchableOpacity
          onPress={() => handleSelectType('elderly')}
          activeOpacity={0.7}
          style={styles.optionCard}
        >
          <Card>
            <Text style={styles.optionTitle}>👴 Elderly User</Text>
            <Text style={styles.optionDescription}>
              Access medication reminders, health tracking, and connect with your doctor
            </Text>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleSelectType('caregiver')}
          activeOpacity={0.7}
          style={styles.optionCard}
        >
          <Card>
            <Text style={styles.optionTitle}>👨‍👩‍👧 Family Caregiver</Text>
            <Text style={styles.optionDescription}>
              Monitor your loved one's health status and receive real-time alerts
            </Text>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleSelectType('doctor')}
          activeOpacity={0.7}
          style={styles.optionCard}
        >
          <Card>
            <Text style={styles.optionTitle}>👨‍⚕️ Healthcare Professional</Text>
            <Text style={styles.optionDescription}>
              Manage patient records and view comprehensive health data
            </Text>
          </Card>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 20, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: colors.textPrimary, marginBottom: 10 },
  subtitle: { fontSize: 12, textAlign: 'center', color: colors.textSecondary, marginBottom: 30 },
  optionCard: { marginBottom: 15 },
  optionTitle: { fontSize: 15, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 8 },
  optionDescription: { fontSize: 11, color: colors.textSecondary, lineHeight: 16 },
});

export default UserTypeScreen;