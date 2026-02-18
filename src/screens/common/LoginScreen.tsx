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
import { getApiUrl } from '../../config/api';

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
      const res = await fetch(getApiUrl('/api/auth/login'), {
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
          // Navigate to elderly dashboard
          navigation.replace('ElderlyApp', { user: data });
        } else if (data.role === 'caregiver' || data.role === 'doctor') {
          // Check if caregiver has connections
          if (data.hasConnection) {
            // Has approved connections - go to caregiver app
            navigation.replace('CaregiverApp', { user: data });
          } else {
            // No connections - need to connect with elder first
            Alert.alert(
              "Connect with Elder", 
              "You need to connect with an elder first. Enter their connection code.",
              [
                {
                  text: "OK",
                  onPress: () => navigation.navigate('ConnectScreen', { 
                    role: data.role, 
                    userId: data.id 
                  })
                }
              ]
            );
          }
        }
      } else {
        Alert.alert("Login Failed", data.message || "Invalid credentials");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Connection Error", "Could not connect to server. Check your network and backend.");
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
            
            <TouchableOpacity onPress={() => Alert.alert("Reset Password", "Feature coming soon")}>
               <Text style={styles.forgotPassword}>Forgot Password?</Text>
            </TouchableOpacity>

            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Signing in...</Text>
              </View>
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
  logoContainer: { alignItems: 'center', marginBottom: 50 },
  logo: {
    width: 100,
    height: 100,
    backgroundColor: colors.primary,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    elevation: 5,
  },
  logoText: { fontSize: 45, fontWeight: 'bold', color: colors.white },
  appName: { 
    fontSize: 32, 
    fontWeight: 'bold', 
    color: colors.textPrimary, 
    marginBottom: 8 
  },
  tagline: { fontSize: 15, color: colors.textSecondary },
  form: { width: '100%' },
  inputHeight: { height: 50, fontSize: 16 },
  forgotPassword: { 
    textAlign: 'right', 
    color: colors.primary, 
    fontSize: 13, 
    marginBottom: 25, 
    fontWeight: '600' 
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 14,
  },
  loginBtn: { height: 55, borderRadius: 12 },
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