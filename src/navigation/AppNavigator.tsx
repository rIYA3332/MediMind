import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/common/LoginScreen';
import UserTypeScreen from '../screens/common/UserTypeScreen';
import RegisterScreen from '../screens/common/RegisterScreen';
import ConnectScreen from '../screens/common/ConnectScreen';
import ElderlyNavigator from './ElderlyNavigator';
import CaregiverNavigator from './CaregiverNavigator';

export type RootStackParamList = {
  Login: undefined;
  UserType: { mode: 'login' | 'register' };
  Register: { role: 'elderly' | 'caregiver' | 'doctor' };
  ConnectScreen: { role: string; userId: number };
  ElderlyApp: { user: any };
  CaregiverApp: { user: any };
  DoctorApp: { user: any };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="UserType" component={UserTypeScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="ConnectScreen" component={ConnectScreen} />
        <Stack.Screen name="ElderlyApp" component={ElderlyNavigator} />
        <Stack.Screen name="CaregiverApp" component={CaregiverNavigator} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;