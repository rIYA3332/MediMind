import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLang } from '../../context/LanguageContext';
import { colors } from '../../styles/colors';

const ProfileScreen: React.FC = () => {
  const { lang, setLang, t } = useLang();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('profile')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('language')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langBtn, lang === 'en' && styles.langBtnActive]}
            onPress={() => setLang('en')}>
            <Text style={[styles.langBtnTxt, lang === 'en' && styles.langBtnTxtActive]}>
              🇬🇧 {t('english')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, lang === 'ne' && styles.langBtnActive]}
            onPress={() => setLang('ne')}>
            <Text style={[styles.langBtnTxt, lang === 'ne' && styles.langBtnTxtActive]}>
              🇳🇵 {t('nepali')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.background },
  header:         { padding: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:    { fontSize: 20, fontWeight: 'bold', color: colors.textPrimary },
  section:        { backgroundColor: colors.white, margin: 16, borderRadius: 14, padding: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  sectionLabel:   { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  langRow:        { flexDirection: 'row', gap: 12 },
  langBtn:        { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.background },
  langBtnActive:  { borderColor: colors.primary, backgroundColor: colors.primary },
  langBtnTxt:     { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  langBtnTxtActive:{ color: '#fff' },
});

export default ProfileScreen;