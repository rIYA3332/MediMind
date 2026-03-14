// navigation/CaregiverNavigator.tsx
import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CaregiverDashboard         from '../screens/caregiver/CaregiverDashboard';
import MonitorHealthScreen        from '../screens/caregiver/MonitorHealthScreen';
import AlertsScreen               from '../screens/caregiver/AlertsScreen';
import ScheduleManagerScreen      from '../screens/caregiver/ScheduleManagerScreen';
import HealthStatusScreen         from '../screens/caregiver/HealthStatusScreen';
import ReportScreen               from '../screens/caregiver/ReportScreen';
import CaregiverVitalsTrendScreen from '../screens/caregiver/.CaregiverVitalsTrendScreen';
import CaregiverChatScreen        from '../screens/caregiver/CaregiverChatScreen';

import { colors } from '../styles/colors';
import { RootStackParamList } from './AppNavigator';
import { getApiUrl } from '../config/api';

type Props = NativeStackScreenProps<RootStackParamList, 'CaregiverApp'>;

export type CaregiverTabParamList = {
  Home:     { user: any };
  Monitor:  { caregiverId?: number; elderId?: number; elderName?: string };
  Schedule: undefined;
  Alerts:   undefined;
  Chat:     undefined;   // params injected via wrapper — no route params needed
};

export type CaregiverStackParamList = {
  CaregiverTabs: undefined;
  HealthStatus:  { elderId: number; elderName: string };
  WeeklyReport:  { elderId: number; elderName: string };
  Report:        { elderId: number; elderName: string };
  VitalsTrend:   { elderId: number; elderName: string };
};

const Tab   = createBottomTabNavigator<CaregiverTabParamList>();
const Stack = createNativeStackNavigator<CaregiverStackParamList>();

// ─── Inner tabs ───────────────────────────────────────────────────────────────
const CaregiverTabs: React.FC<{
  caregiverId: number;
  elderId: number | null;
  elderName: string;
}> = ({ caregiverId, elderId, elderName }) => {

  // Wrap CaregiverChatScreen to inject elderId/caregiverId without
  // touching the screen's own signature or adding params to the tab type
  const ChatScreenWithProps = React.useCallback(
    (navProps: any) => (
      <CaregiverChatScreen
        {...navProps}
        route={{
          ...navProps.route,
          params: {
            elderId:       elderId ?? undefined,
            caregiverId,
            caregiverName: elderName,
          },
        }}
      />
    ),
    [elderId, caregiverId, elderName],
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown:             false,
        tabBarActiveTintColor:   colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle:      { height: 62, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={CaregiverDashboard}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Icon name="home" color={color} size={size} />,
        }}
      />

      <Tab.Screen
        name="Monitor"
        component={MonitorHealthScreen}
        initialParams={{ caregiverId }}
        options={{
          tabBarLabel: 'Monitor',
          tabBarIcon: ({ color, size }) => <Icon name="pulse" color={color} size={size} />,
        }}
      />

      <Tab.Screen
        name="Schedule"
        component={ScheduleManagerScreen}
        options={{
          tabBarLabel: 'Schedule',
          tabBarIcon: ({ color, size }) => <Icon name="calendar" color={color} size={size} />,
        }}
      />

      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarLabel: 'Alerts',
          tabBarIcon: ({ color, size }) => <Icon name="notifications" color={color} size={size} />,
        }}
      />

      {/* ── Chat tab — talks to connected doctors ── */}
      <Tab.Screen
        name="Chat"
        component={ChatScreenWithProps}
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: ({ color, size }) => (
            <Icon name="chatbubble-ellipses" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

// ─── Root stack navigator ─────────────────────────────────────────────────────
const CaregiverNavigator: React.FC<Props> = ({ route }) => {
  const { user } = route.params;
  const caregiverId = Number(user.id);

  // elderId is NOT on the user object at login time — fetch it
  const [elderId, setElderId]     = useState<number | null>(null);
  const [elderName, setElderName] = useState<string>('');

  useEffect(() => {
    if (user) AsyncStorage.setItem('user', JSON.stringify(user)).catch(() => {});
  }, [user]);

  useEffect(() => {
    const fetchElder = async () => {
      try {
        const res = await fetch(getApiUrl(`/api/caregiver/elder/${caregiverId}`));
        if (!res.ok) return;
        const data = await res.json();
        // handles both { id, name } and [{ id, name }]
        const elder = Array.isArray(data) ? data[0] : data;
        if (elder?.id) {
          setElderId(Number(elder.id));
          if (elder.name) setElderName(elder.name);
        }
      } catch (e) {
        console.log('fetchElder error:', e);
      }
    };
    fetchElder();
  }, [caregiverId]);

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="CaregiverTabs"
        children={() => (
          <CaregiverTabs
            caregiverId={caregiverId}
            elderId={elderId}
            elderName={elderName}
          />
        )}
      />
      <Stack.Screen name="HealthStatus" component={HealthStatusScreen} />
      <Stack.Screen name="WeeklyReport" component={ReportScreen} />
      <Stack.Screen name="Report"       component={ReportScreen} />
      <Stack.Screen name="VitalsTrend"  component={CaregiverVitalsTrendScreen} />
    </Stack.Navigator>
  );
};

export default CaregiverNavigator;