import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from './AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'DoctorApp'>;

const Tab = createBottomTabNavigator();

const DoctorNavigator: React.FC<Props> = ({ route }) => {
  const { user } = route.params;

  const DoctorHome = () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Welcome Doctor {user.name}</Text>
    </View>
  );

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={DoctorHome} />
    </Tab.Navigator>
  );
};

export default DoctorNavigator;
