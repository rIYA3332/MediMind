// navigation/DoctorNavigator.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import DoctorDashboard       from '../screens/doctor/DoctorDashboard';
import PatientsListScreen    from '../screens/doctor/PatientsListScreen';
import PatientDetailScreen   from '../screens/doctor/PatientDetailsScreen';
import DoctorProfileScreen   from '../screens/doctor/DoctorProfileScreen';
import ReportScreen          from '../screens/caregiver/ReportScreen';

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

// ── Profile stack with UNIQUE name ─────────────────────────────────────────
const ProfileStack = ({ params }: { params: any }) => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    {/* CHANGED: Use unique name "DoctorProfileScreenMain" instead of "DoctorProfile" */}
    <Stack.Screen name="DoctorProfileScreenMain" component={DoctorProfileScreen} initialParams={params} />
  </Stack.Navigator>
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
        name="DoctorProfileTab"
        options={{ tabBarLabel: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size} /> }}
      >
        {() => <ProfileStack params={params} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

export default DoctorNavigator;