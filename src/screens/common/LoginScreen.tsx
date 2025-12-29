import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Button from '../../components/Button';
import Input from '../../components/Input';
import { colors } from '../../styles/colors';
import { RootStackParamList } from '../../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password");
      return;
    }

    setLoading(true);
    try {
      // Ensure this IP matches your computer's local IP address
      const res = await fetch('http://10.125.81.28:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: email.trim().toLowerCase(), 
          password: password 
        }),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.role === 'elderly') {
          
          navigation.navigate('ElderlyApp', { user: data });
        } else {
          // Caregiver/Doctor Logic
          if (data.status === 'pending') {
            Alert.alert("Pending", "Waiting for Elder approval.");
          } else if (data.status === 'none') {
            // If they registered but haven't entered a code yet
            navigation.navigate('ConnectScreen', { role: data.role, userId: data.id });
          } else {
            Alert.alert("Success", `Logged in as ${data.name}`);
            // navigation.navigate('CaregiverApp', { user: data });
          }
        }
      } else {
        Alert.alert("Login Failed", data.message || "Invalid credentials");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Connection Error", "Could not connect to server. Check your IP and ensure backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>M</Text>
            </View>
            <Text style={styles.appName}>MediMind</Text>
            <Text style={styles.tagline}>Your Health Companion</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              keyboardType="email-address"
              style={styles.inputHeight}
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              secureTextEntry
              style={styles.inputHeight}
            />
            
            <TouchableOpacity onPress={() => Alert.alert("Reset Password", "Coming soon")}>
               <Text style={styles.forgotPassword}>Forgot Password?</Text>
            </TouchableOpacity>

            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <Button title="Login" onPress={handleLogin} style={styles.loginBtn} />
            )}

            <View style={styles.signupContainer}>
              <Text style={styles.signupText}>Don't have an account? </Text>
              <TouchableOpacity 
                onPress={() => navigation.navigate('UserType', { mode: 'register' })}
              >
                <Text style={styles.signupLink}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  keyboardView: { flex: 1 },
  content: { flex: 1, padding: 25, justifyContent: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: 40 },
  logo: {
    width: 90,
    height: 90,
    backgroundColor: colors.primary,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  logoText: { fontSize: 40, fontWeight: 'bold', color: colors.white },
  appName: { fontSize: 28, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 5 },
  tagline: { fontSize: 14, color: colors.textSecondary },
  form: { width: '100%' },
  inputHeight: { height: 50, fontSize: 16 }, // Bigger text and height
  forgotPassword: { textAlign: 'right', color: colors.primary, fontSize: 13, marginBottom: 25, fontWeight: '600' },
  loginBtn: { height: 55, borderRadius: 12 }, // Bigger button
  signupContainer: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    marginTop: 30, 
    alignItems: 'center' 
  },
  signupText: { fontSize: 15, color: colors.textSecondary },
  signupLink: { color: colors.primary, fontWeight: 'bold', fontSize: 15 },
});

export default LoginScreen;