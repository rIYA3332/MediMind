import React, { createContext, useContext, useState } from 'react';

interface User {
  id: number;
  role: string;
  name: string;
  email: string;
  code?: string;
  hasConnection?: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (userData: User) => void;
  logout: () => void;
   setCaregiverId: (id: number) => void; // NEW
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = (userData: User) => setUser(userData);
  const logout = () => setUser(null);
  // Inside AuthProvider:
const setCaregiverId = (id: number) => {
  if (user) setUser({ ...user, id }); 
  else setUser({ id, role: 'caregiver', name: '', email: '' });
};

  return (
    <AuthContext.Provider value={{ user, login, logout, setCaregiverId  }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
