// CaregiverNavigator.tsx
// ──────────────────────────────────────────────────────────────────────────────
// HOW THE NAVIGATION IS STRUCTURED:
//   CaregiverStack (NativeStack)
//     ├── CaregiverTabs  (Bottom Tab — Home / Monitor / Alerts)
//     ├── HealthStatus   ← pushed on top of tabs (no tab bar visible)
//     └── Report         ← pushed on top of tabs (no tab bar visible)
//
// This is why "navigate('HealthStatus')" and "navigate('WeeklyReport')" were
// crashing — they weren't registered anywhere. Now they are.
// ──────────────────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CaregiverDashboard   from '../screens/caregiver/CaregiverDashboard';
import MonitorHealthScreen  from '../screens/caregiver/MonitorHealthScreen';
import AlertsScreen         from '../screens/caregiver/AlertsScreen';
import HealthStatusScreen   from '../screens/caregiver/HealthStatusScreen';
import ReportScreen         from '../screens/caregiver/ReportScreen';

import { colors } from '../styles/colors';
import { RootStackParamList } from './AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CaregiverApp'>;

// ── Tab param list 
export type CaregiverTabParamList = {
  Home:    { user: any };
  Monitor: { elderId?: number; elderName?: string };
  Alerts:  undefined;
};

// ── Stack param list (tab screens + modal screens) 
export type CaregiverStackParamList = {
  CaregiverTabs:  undefined;
  HealthStatus:   { elderId: number; elderName: string };
  WeeklyReport:   { elderId: number; elderName: string }; // kept for backward compat
  Report:         { elderId: number; elderName: string };
};

const Tab   = createBottomTabNavigator<CaregiverTabParamList>();
const Stack = createNativeStackNavigator<CaregiverStackParamList>();

// ── Inner Tab Navigator 
const CaregiverTabs: React.FC = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor:   colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarStyle:      { height: 60, paddingBottom: 8, paddingTop: 8 },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
    }}
  >
    <Tab.Screen
      name="Home"
      component={CaregiverDashboard}
      options={{ tabBarIcon: ({ color, size }) => <Icon name="home" color={color} size={size} /> }}
    />
    <Tab.Screen
      name="Monitor"
      component={MonitorHealthScreen}
      options={{ tabBarIcon: ({ color, size }) => <Icon name="pulse" color={color} size={size} /> }}
    />
    <Tab.Screen
      name="Alerts"
      component={AlertsScreen}
      options={{ tabBarIcon: ({ color, size }) => <Icon name="notifications" color={color} size={size} /> }}
    />
  </Tab.Navigator>
);

//  Outer Stack Navigator 
const CaregiverNavigator: React.FC<Props> = ({ route }) => {
  const { user } = route.params;

  useEffect(() => {
    if (user) {
      AsyncStorage.setItem('user', JSON.stringify(user)).catch(e => console.log('Save user error:', e));
    }
  }, [user]);

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CaregiverTabs" component={CaregiverTabs} />
      <Stack.Screen name="HealthStatus"  component={HealthStatusScreen} />
      <Stack.Screen name="WeeklyReport"  component={ReportScreen} />
      <Stack.Screen name="Report"        component={ReportScreen} />
    </Stack.Navigator>
  );
};

export default CaregiverNavigator;