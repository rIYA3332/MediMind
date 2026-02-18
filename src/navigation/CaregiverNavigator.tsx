import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CaregiverDashboard from '../screens/caregiver/CaregiverDashboard';
import MonitorHealthScreen from '../screens/caregiver/MonitorHealthScreen';
import AlertsScreen from '../screens/caregiver/AlertsScreen';

import { colors } from '../styles/colors';
import { RootStackParamList } from './AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CaregiverApp'>;

export type CaregiverTabParamList = {
  Home: { user: any };
  Monitor: { elderId?: number; elderName?: string };
  Alerts: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<CaregiverTabParamList>();

const CaregiverNavigator: React.FC<Props> = ({ route }) => {
  const { user } = route.params;

  // Save user to AsyncStorage when navigator mounts
  useEffect(() => {
    const saveUser = async () => {
      try {
        await AsyncStorage.setItem('user', JSON.stringify(user));
        console.log('Caregiver user saved to storage:', user);
      } catch (e) {
        console.log('Error saving user:', e);
      }
    };
    
    if (user) {
      saveUser();
    }
  }, [user]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={CaregiverDashboard}
        initialParams={{ user }}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="home" color={color} size={size} />
          ),
        }}
      />
      
      <Tab.Screen
        name="Monitor"
        component={MonitorHealthScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="pulse" color={color} size={size} />
          ),
        }}
      />
      
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="notifications" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default CaregiverNavigator;