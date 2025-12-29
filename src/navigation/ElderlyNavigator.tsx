import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons as Icon } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import ElderlyDashboard from '../screens/elderly/ElderlyDashboard';
import MedicationScreen from '../screens/elderly/MedicationScreen';
import LogHealthScreen from '../screens/elderly/LogHealthScreen';
import ProfileScreen from '../screens/elderly/ProfileScreen';

import { colors } from '../styles/colors';
import { ElderlyTabParamList } from './types';
import { RootStackParamList } from './AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ElderlyApp'>;

const Tab = createBottomTabNavigator<ElderlyTabParamList>();

const ElderlyNavigator: React.FC<Props> = ({ route }) => {
  // Extract user from Login params
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
        name="Home"
        component={ElderlyDashboard}
        // Pass user to the actual Dashboard screen
        initialParams={{ user: user }} 
        options={{
          tabBarIcon: ({ color, size }) => <Icon name="home-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen name="Meds" component={MedicationScreen} options={{
          tabBarIcon: ({ color, size }) => <Icon name="medkit-outline" color={color} size={size} />,
      }} />
      <Tab.Screen name="Health" component={LogHealthScreen} options={{
          tabBarIcon: ({ color, size }) => <Icon name="heart-outline" color={color} size={size} />,
      }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{
          tabBarIcon: ({ color, size }) => <Icon name="person-outline" color={color} size={size} />,
      }} />
    </Tab.Navigator>
  );
};

export default ElderlyNavigator;