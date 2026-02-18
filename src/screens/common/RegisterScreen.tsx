import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/AppNavigator';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

const RegisterScreen: React.FC<Props> = ({ route, navigation }) => {
  const { role } = route.params;
  const [loading, setLoading] = useState(false);
  const [gender, setGender] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '', dob: '', emergency: ''
  });

  const handleRegister = async () => {
    if (!form.name || !form.email || !form.password) {
      Alert.alert("Error", "Please fill required fields");
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
        Alert.alert("Error", data.message);
      }
    } catch (e) {
      Alert.alert("Connection Error", "Check your Server/IP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.photoPlaceholder}><Text style={{color: '#999'}}>Add Photo</Text></View>
        
        <Input label="Full Name *" value={form.name} onChangeText={(t) => setForm({...form, name: t})} style={styles.bigInput} />
        <Input label="Email *" value={form.email} onChangeText={(t) => setForm({...form, email: t})} keyboardType="email-address" style={styles.bigInput} />
        <Input label="Password *" value={form.password} onChangeText={(t) => setForm({...form, password: t})} secureTextEntry style={styles.bigInput} />
        <Input label="Date of Birth *" placeholder="DD/MM/YYYY" value={form.dob} onChangeText={(t) => setForm({...form, dob: t})} style={styles.bigInput} />
        
        <Text style={styles.label}>Gender</Text>
        <View style={styles.genderRow}>
          {['Male', 'Female', 'Other'].map((item) => (
            <TouchableOpacity 
              key={item} 
              style={[styles.genderBox, gender === item && styles.genderSelected]} 
              onPress={() => setGender(item)}
            >
              <Text style={[styles.genderText, gender === item && styles.genderTextSelected]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Phone Number" value={form.phone} onChangeText={(t) => setForm({...form, phone: t})} keyboardType="phone-pad" style={styles.bigInput} />
        
        {/*  */}
        {role === 'elderly' && (
          <Input 
            label="Emergency Contact" 
            value={form.emergency} 
            onChangeText={(t) => setForm({...form, emergency: t})} 
            style={styles.bigInput} 
          />
        )}

        {loading ? <ActivityIndicator color={colors.primary} size="large" /> : (
          <Button 
            title={role === 'elderly' ? "CONTINUE" : "REGISTER & CONNECT"} 
            onPress={handleRegister} 
            style={styles.continueBtn} 
          />
        )}
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
  continueBtn: { height: 55, marginTop: 10, borderRadius: 12 }
});

export default RegisterScreen;