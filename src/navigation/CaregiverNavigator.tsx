// navigation/CaregiverNavigator.tsx
import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CaregiverDashboard    from '../screens/caregiver/CaregiverDashboard';
import MonitorHealthScreen   from '../screens/caregiver/MonitorHealthScreen';
import AlertsScreen          from '../screens/caregiver/AlertsScreen';
import ScheduleManagerScreen from '../screens/caregiver/ScheduleManagerScreen';
import HealthStatusScreen    from '../screens/caregiver/HealthStatusScreen';
import ReportScreen          from '../screens/caregiver/ReportScreen';

import { colors } from '../styles/colors';
import { RootStackParamList } from './AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CaregiverApp'>;

export type CaregiverTabParamList = {
  Home:     { user: any };
  // caregiverId is passed as initialParams so MonitorHealthScreen
  // always knows which caregiver it belongs to, even as a tab screen
  Monitor:  { caregiverId?: number; elderId?: number; elderName?: string };
  Schedule: undefined;
  Alerts:   undefined;
};

export type CaregiverStackParamList = {
  CaregiverTabs: undefined;
  HealthStatus:  { elderId: number; elderName: string };
  WeeklyReport:  { elderId: number; elderName: string };
  Report:        { elderId: number; elderName: string };
};

const Tab   = createBottomTabNavigator<CaregiverTabParamList>();
const Stack = createNativeStackNavigator<CaregiverStackParamList>();

// CaregiverTabs receives caregiverId so it can pass it as initialParams
// to the Monitor tab. Without this, MonitorHealthScreen gets no params
// when opened via the tab bar and shows nothing.
const CaregiverTabs: React.FC<{ caregiverId: number }> = ({ caregiverId }) => (
  <Tab.Navigator
    screenOptions={{
      headerShown:           false,
      tabBarActiveTintColor:   colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarStyle:      { height: 62, paddingBottom: 8, paddingTop: 6 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}>

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
      // initialParams ensures caregiverId is always available even when
      // the screen is opened by tapping the tab (no navigation.navigate call)
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
  </Tab.Navigator>
);

const CaregiverNavigator: React.FC<Props> = ({ route }) => {
  const { user } = route.params;

  useEffect(() => {
    if (user) AsyncStorage.setItem('user', JSON.stringify(user)).catch(() => {});
  }, [user]);

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/*
        Use children prop so we can pass caregiverId into CaregiverTabs.
        Standard component prop doesn't allow custom props.
      */}
      <Stack.Screen
        name="CaregiverTabs"
        children={() => <CaregiverTabs caregiverId={Number(user.id)} />}
      />
      <Stack.Screen name="HealthStatus" component={HealthStatusScreen} />
      <Stack.Screen name="WeeklyReport" component={ReportScreen} />
      <Stack.Screen name="Report"       component={ReportScreen} />
    </Stack.Navigator>
  );
};

export default CaregiverNavigator;