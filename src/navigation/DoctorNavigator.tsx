// navigation/DoctorNavigator.tsx
import React from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

import DoctorDashboard     from '../screens/doctor/DoctorDashboard';
import PatientsListScreen  from '../screens/doctor/PatientsListScreen';
import PatientDetailScreen from '../screens/doctor/PatientDetailsScreen';
// ✅ Same ReportScreen caregivers use — full AI-powered report
import ReportScreen        from '../screens/caregiver/ReportScreen';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// ── Home stack: Dashboard → PatientDetail → PatientReport ────────────────────
const HomeStack = ({ params }: { params: any }) => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="DoctorDashboardMain" component={DoctorDashboard} initialParams={params} />
    <Stack.Screen name="PatientDetail"       component={PatientDetailScreen} />
    <Stack.Screen name="PatientReport"       component={ReportScreen} />
  </Stack.Navigator>
);

// ── Patients stack: list → detail → report ───────────────────────────────────
const PatientsStack = ({ params }: { params: any }) => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="PatientsList"  component={PatientsListScreen}   initialParams={params} />
    <Stack.Screen name="PatientDetail" component={PatientDetailScreen} />
    <Stack.Screen name="PatientReport" component={ReportScreen} />
  </Stack.Navigator>
);

// ── Profile with logout ───────────────────────────────────────────────────────
const ProfileScreen = ({ navigation }: any) => {
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          try { await AsyncStorage.multiRemove(['user', 'caregiverId']); } catch {}
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };
  return (
    <View style={PS.screen}>
      <View style={PS.card}>
        <Text style={PS.title}>Doctor Account</Text>
        <TouchableOpacity style={PS.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={PS.logoutTxt}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
const PS = StyleSheet.create({
  screen:    { flex: 1, backgroundColor: '#f0f2f5', justifyContent: 'center', alignItems: 'center' },
  card:      { backgroundColor: '#fff', borderRadius: 16, padding: 32, width: '85%', alignItems: 'center', elevation: 2 },
  title:     { fontSize: 18, fontWeight: '700', color: '#2c3e50', marginBottom: 28 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e74c3c', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, width: '100%', justifyContent: 'center' },
  logoutTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const AlertsScreen = () => (
  <View style={{ flex: 1, backgroundColor: '#f0f2f5', justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: 16, color: '#7f8c8d' }}>Alerts coming soon</Text>
  </View>
);

// ── Main Tab Navigator ────────────────────────────────────────────────────────
const DoctorNavigator = ({ route }: any) => {
  const params = route?.params || {};
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   '#3498db',
        tabBarInactiveTintColor: '#95a5a6',
        tabBarStyle:      { height: 62, paddingBottom: 8, paddingTop: 6, backgroundColor: '#fff', borderTopColor: '#ecf0f1' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="DoctorHome"
        options={{ tabBarLabel: 'Dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }}
      >
        {() => <HomeStack params={params} />}
      </Tab.Screen>

      <Tab.Screen
        name="DoctorPatients"
        options={{ tabBarLabel: 'Patients', tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }}
      >
        {() => <PatientsStack params={params} />}
      </Tab.Screen>

      <Tab.Screen
        name="DoctorAlerts"
        component={AlertsScreen}
        options={{ tabBarLabel: 'Alerts', tabBarIcon: ({ color, size }) => <Ionicons name="notifications" color={color} size={size} /> }}
      />

      <Tab.Screen
        name="DoctorProfile"
        component={ProfileScreen}
        options={{ tabBarLabel: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size} /> }}
      />
    </Tab.Navigator>
  );
};

export default DoctorNavigator;