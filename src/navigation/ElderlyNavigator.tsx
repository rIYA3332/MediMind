// navigation/ElderlyNavigator.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import ElderlyDashboard             from '../screens/elderly/ElderlyDashboard';
import MedicationScreen             from '../screens/elderly/MedicationScreen';
import LogHealthScreen              from '../screens/elderly/LogHealthScreen';
import ProfileScreen                from '../screens/elderly/ProfileScreen';
import MoodCheckScreen              from '../screens/elderly/MoodCheckScreen';
import ElderlyRecommendationScreen  from '../screens/elderly/ElderlyRecommendationScreen'; // ← new

import { colors } from '../styles/colors';
import { RootStackParamList } from './AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ElderlyApp'>;

export type ElderlyTabParamList = {
  Home:            { user: any };
  Meds:            undefined;
  Health:          undefined;
  Recommendations: undefined;   // ← new
  Profile:         undefined;
};

export type ElderlyStackParamList = {
  MainTabs: { user: any };
  MoodCheck: undefined;
};

const Tab   = createBottomTabNavigator<ElderlyTabParamList>();
const Stack = createNativeStackNavigator<ElderlyStackParamList>();

const ElderlyTabs: React.FC<{ user: any }> = ({ user }) => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor:   colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarStyle:      { height: 60, paddingBottom: 8, paddingTop: 8 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}
  >
    <Tab.Screen
      name="Home"
      component={ElderlyDashboard}
      initialParams={{ user }}
      options={{ tabBarIcon: ({ color, size }) => <Icon name="home" color={color} size={size} /> }}
    />
    <Tab.Screen
      name="Meds"
      component={MedicationScreen}
      options={{
        tabBarLabel: 'Meds',
        tabBarIcon: ({ color, size }) => <Icon name="medical" color={color} size={size} />,
      }}
    />
    <Tab.Screen
      name="Health"
      component={LogHealthScreen}
      options={{ tabBarIcon: ({ color, size }) => <Icon name="fitness" color={color} size={size} /> }}
    />

    {/* ── NEW: Recommendations tab ── */}
    <Tab.Screen
      name="Recommendations"
      component={ElderlyRecommendationScreen}
      options={{
        tabBarLabel: 'Care Plan',
        tabBarIcon: ({ color, size }) => <Icon name="medical-outline" color={color} size={size} />,
      }}
    />

    <Tab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ tabBarIcon: ({ color, size }) => <Icon name="person" color={color} size={size} /> }}
    />
  </Tab.Navigator>
);

const ElderlyNavigator: React.FC<Props> = ({ route }) => {
  const { user } = route.params;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs">
        {() => <ElderlyTabs user={user} />}
      </Stack.Screen>
      <Stack.Screen
        name="MoodCheck"
        component={MoodCheckScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
          headerTitle: 'Mood Check',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      />
    </Stack.Navigator>
  );
};

export default ElderlyNavigator;