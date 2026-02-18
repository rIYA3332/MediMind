import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';


import MonitorHealthScreen from '../screens/caregiver/MonitorHealthScreen';
import AlertsScreen from '../screens/caregiver/AlertsScreen';
// import CaregiverProfileScreen from '../screens/caregiver/CaregiverProfileScreen';


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

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      
      
      <Tab.Screen
        name="Monitor"
        component={MonitorHealthScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="pulse-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Icon name="notifications-outline" color={color} size={size} />
          ),
        }}
      />
     
      
    </Tab.Navigator>
  );
};

export default CaregiverNavigator;