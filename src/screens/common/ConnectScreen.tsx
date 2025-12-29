import React, { useState } from 'react';
import { 
  View, Text, StyleSheet, Alert, ActivityIndicator, 
  SafeAreaView, KeyboardAvoidingView, Platform, ScrollView 
} from 'react-native';
import { Picker } from '@react-native-picker/picker'; 
import Input from '../../components/Input';
import Button from '../../components/Button';
import { colors } from '../../styles/colors';

const ConnectScreen = ({ route, navigation }: any) => {
  const { role, userId } = route.params;
  const [targetInfo, setTargetInfo] = useState(''); // For Email/Phone
  const [targetCode, setTargetCode] = useState('');
  const [relationship, setRelationship] = useState('Son/Daughter');
  const [loading, setLoading] = useState(false);

  const handleRequest = async () => {
    if (!targetCode && !targetInfo) {
      Alert.alert("Error", "Please enter elder's details or registration code");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://10.125.81.28:3000/api/auth/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          requesterId: userId, 
          targetCode: targetCode.trim().toUpperCase(),
          relationship: relationship // Added to payload
        }),
      });

      const data = await response.json();
      if (response.ok) {
        Alert.alert("Success", data.message, [{ text: "OK", onPress: () => navigation.navigate('Login') }]);
      } else {
        Alert.alert("Request Failed", data.message);
      }
    } catch (e) { Alert.alert("Error", "Connection failed"); }
    finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.headerTitle}>Connect with Elder</Text>
          <Text style={styles.subtitle}>Enter elder's details to start monitoring</Text>

          <View style={styles.form}>
            <Input 
              label="Elder's Email or Phone *" 
              value={targetInfo} 
              onChangeText={setTargetInfo} 
              placeholder="Enter details" 
            />

            <Text style={styles.orText}>OR Enter Registration Code</Text>
            <Input 
              value={targetCode} 
              onChangeText={setTargetCode} 
              placeholder="- - - - - -" 
             
              style={styles.codeInput}
            />
            <Text style={styles.hintText}>Ask elder for their unique code</Text>

            <Text style={styles.label}>Your Relationship</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={relationship}
                onValueChange={(itemValue) => setRelationship(itemValue)}
              >
                <Picker.Item label="Son/Daughter" value="Son/Daughter" />
                <Picker.Item label="Doctor" value="Doctor" />
                <Picker.Item label="Spouse" value="Spouse" />
                <Picker.Item label="Other" value="Other" />
              </Picker>
            </View>

            {loading ? <ActivityIndicator color={colors.primary} size="large" /> : (
              <Button title="SEND CONNECTION REQUEST" onPress={handleRequest} style={styles.submitBtn} />
            )}

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ℹ️ Elder must approve your request before you can monitor their health
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 25, alignItems: 'center' },
  headerTitle: { fontSize: 26, fontWeight: 'bold', color: '#2c3e50', marginTop: 40 },
  subtitle: { fontSize: 14, color: '#7f8c8d', marginBottom: 30 },
  form: { width: '100%' },
  orText: { fontSize: 14, fontWeight: 'bold', color: '#2c3e50', marginTop: 20, marginBottom: 10 },
  codeInput: { textAlign: 'center', fontSize: 20, letterSpacing: 5 },
  hintText: { fontSize: 12, color: '#95a5a6', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: 'bold', color: '#2c3e50', marginBottom: 10 },
  pickerContainer: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, marginBottom: 30 },
  submitBtn: { height: 55, borderRadius: 10, backgroundColor: '#3498db' },
  infoBox: { backgroundColor: '#e8f6ef', padding: 15, borderRadius: 10, marginTop: 25 },
  infoText: { color: '#27ae60', fontSize: 13, textAlign: 'center', lineHeight: 18 }
});

export default ConnectScreen;