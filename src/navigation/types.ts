export type RootStackParamList = {
  Login: undefined;
  // UserType needs to know if we are logging in or registering
  UserType: { mode: 'login' | 'register' }; 
  
  // Pass the user object (id, name, role, code) from Login to the App
  ElderlyApp: { user: any }; 
  CaregiverApp: { user: any };
  DoctorApp: { user: any };

  // Registration and Connection
  Register: { role: 'elderly' | 'caregiver' | 'doctor' };
  ConnectScreen: { role: string; userId: number };

  // Screens inside Stack
  LogHealth: undefined;
  MoodCheck: undefined;
  Medications: undefined;
  ContactDoctor: undefined;
};

export type ElderlyTabParamList = {
  // The Home (Dashboard) needs the user object to display the name
  Home: { user: any }; 
  Meds: undefined;
  Health: undefined;
  Profile: undefined;
};