import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/AppNavigator';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

// Defined OUTSIDE the component so it doesn't re-create on every render
const ErrorBanner = ({ message }: { message: string }) => {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <View style={styles.errorIconWrap}>
        <Text style={styles.errorIcon}>!</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.errorTitle}>Email already registered</Text>
        <Text style={styles.errorBody}>{message}</Text>
      </View>
    </View>
  );
};

const RegisterScreen: React.FC<Props> = ({ route, navigation }) => {
  const { role } = route.params;
  const [loading, setLoading] = useState(false);
  const [gender, setGender] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '', dob: '', emergency: ''
  });

  const handleRegister = async () => {
    setErrorMessage('');

    if (!form.name || !form.email || !form.password) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, role, gender }),
      });

      const data = await response.json();

      if (response.ok) {
        if (role === 'elderly') {
          Alert.alert("Success", `Account created! Your Code: ${data.registration_code}`,
            [{ text: "Go to Login", onPress: () => navigation.navigate('Login') }]);
        } else {
          navigation.navigate('ConnectScreen', { role, userId: data.userId });
        }
      } else {
        setErrorMessage(
          data.message === 'Email already exists'
            ? 'An account with this email address already exists. Please log in or use a different email.'
            : data.message
        );
      }
    } catch (e) {
      setErrorMessage('Unable to connect. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.photoPlaceholder}>
          <Text style={{ color: '#999' }}>Add Photo</Text>
        </View>

        <Input
          label="Full Name *"
          value={form.name}
          onChangeText={(t) => setForm({ ...form, name: t })}
          style={styles.bigInput}
        />

        {/* Email field + inline error banner */}
        <Input
          label="Email *"
          value={form.email}
          onChangeText={(t) => { setForm({ ...form, email: t }); setErrorMessage(''); }}
          keyboardType="email-address"
          style={StyleSheet.flatten([styles.bigInput, errorMessage ? styles.inputError : undefined])}
        />
        <ErrorBanner message={errorMessage} />

        <Input
          label="Password *"
          value={form.password}
          onChangeText={(t) => setForm({ ...form, password: t })}
          secureTextEntry
          style={styles.bigInput}
        />
        <Input
          label="Date of Birth *"
          placeholder="DD/MM/YYYY"
          value={form.dob}
          onChangeText={(t) => setForm({ ...form, dob: t })}
          style={styles.bigInput}
        />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.genderRow}>
          {['Male', 'Female', 'Other'].map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.genderBox, gender === item && styles.genderSelected]}
              onPress={() => setGender(item)}
            >
              <Text style={[styles.genderText, gender === item && styles.genderTextSelected]}>
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input
          label="Phone Number"
          value={form.phone}
          onChangeText={(t) => setForm({ ...form, phone: t })}
          keyboardType="phone-pad"
          style={styles.bigInput}
        />

        {role === 'elderly' && (
          <Input
            label="Emergency Contact"
            value={form.emergency}
            onChangeText={(t) => setForm({ ...form, emergency: t })}
            style={styles.bigInput}
          />
        )}

        {loading
          ? <ActivityIndicator color={colors.primary} size="large" />
          : (
            <Button
              title={role === 'elderly' ? "CONTINUE" : "REGISTER & CONNECT"}
              onPress={handleRegister}
              style={styles.continueBtn}
            />
          )
        }
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f5f5f5', flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 25, padding: 20, elevation: 5 },
  photoPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#eee', alignSelf: 'center', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  label: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  bigInput: { height: 50, fontSize: 16 },
  genderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  genderBox: { flex: 1, height: 45, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginHorizontal: 5 },
  genderSelected: { backgroundColor: colors.primary },
  genderText: { color: colors.primary, fontWeight: 'bold', fontSize: 16 },
  genderTextSelected: { color: '#fff' },
  continueBtn: { height: 55, marginTop: 10, borderRadius: 12 },
  // Error styles
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FCEBEB', borderLeftWidth: 3, borderLeftColor: '#E24B4A', borderRadius: 8, padding: 12, gap: 8, marginBottom: 16 },
  errorIconWrap: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#A32D2D', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  errorIcon: { fontSize: 11, fontWeight: '700', color: '#A32D2D' },
  errorTitle: { fontSize: 13, fontWeight: '600', color: '#791F1F', marginBottom: 2 },
  errorBody: { fontSize: 12, color: '#A32D2D', lineHeight: 18 },
  inputError: { borderColor: '#E24B4A', borderWidth: 1.5 },
});

export default RegisterScreen;