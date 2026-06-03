import React, { createContext, useContext, useState } from 'react';

type Lang = 'en' | 'ne';

const translations = {
  en: {
    // Dashboard
    goodMorning: 'Good Morning',
    goodAfternoon: 'Good Afternoon',
    goodEvening: 'Good Evening',
    nextMedication: 'Next Medication',
    quickActions: 'Quick Actions',
    logHealthData: 'Log Health Data',
    moodCheckin: 'Mood Check-in',
    viewMedications: 'View Medications',
    recommendations: 'Recommendations',
    todaySummary: "Today's Summary",
    medications: 'Medications',
    taken: 'taken',
    healthLogs: 'Health Logs',
    entries: 'entries',
    entry: 'entry',
    today: 'today',
    mood: 'Mood',
    recordedToday: 'Recorded today',
    notRecorded: 'Not recorded',
    onTrack: 'On Track',
    pending: 'Pending',
    active: 'Active',
    none: 'None',
    done: 'Done',
    monitor: 'Monitor',
    pendingRequests: 'Pending Requests',
    wantsToMonitor: 'wants to monitor your health',
    approve: '✓ Approve',
    reject: '✕ Reject',
    connectionCode: 'Your Connection Code',
    shareCode: 'Share with family or doctor to get started',
    due: 'Due',
    featureComingSoon: 'Feature coming soon!',

    // Health Log
    logHealth: 'Log Health',
    history: 'History',
    selectMetric: 'Select Health Metric',
    enterValue: 'Enter',
    value: 'Value',
    notes: 'Notes',
    notesOptional: 'Notes (optional)',
    logHealthDataBtn: 'Log Health Data',
    saving: 'Saving…',
    quickReference: '📋 Quick Reference',
    noHealthLogs: 'No health logs yet',
    switchToLog: 'Switch to the Log tab to record your first health reading.',
    valueLooksGood: '✅ Value looks good',
    bloodPressure: 'Blood Pressure',
    bloodSugar: 'Blood Sugar',
    weight: 'Weight',
    temperature: 'Temperature',
    heartRate: 'Heart Rate',

    // Medications
    myMedications: 'My Medications',
    noMedications: 'No medications scheduled yet.',
    dueNow: '⏰ Due Now',
    upcoming: '🔜 Upcoming',
    todaySchedule: '📅 Today',
    takenBtn: '✅ Taken',
    notTakenBtn: '❌ Not Taken',
    doctorPrescribed: 'Prescribed by doctor — awaiting schedule from caregiver',
    noTimeSet: 'No time set',

    // Mood
    howAreYouFeeling: 'How are you feeling?',
    checkinHelps: 'Your check-in helps your caregiver look after you',
    happy: 'Happy',
    neutral: 'Neutral',
    sad: 'Sad',
    anxious: 'Anxious',
    tired: 'Tired',
    lonely: 'Lonely',
    tellUsMore: 'Tell us more (Optional)',
    submitCheckin: 'SUBMIT CHECK-IN',
    recentCheckins: 'Recent Check-ins',
    noMoodYet: 'No mood data yet. Submit your first check-in!',
    moodRecorded: '✓ Mood Recorded',
    caregiverNotified: '📱 Your caregiver has been notified.',
    caregiverCanSee: 'Your caregiver can see this check-in anytime.',
    concernScore: 'Concern score',

    // Reminders
    todaysSchedule: "Today's Schedule",
    nothingScheduled: 'Nothing scheduled today',
    nothingScheduledSub: "Your caregiver hasn't scheduled any tasks yet.",
    overdue: 'overdue',
    upcomingPill: 'Upcoming',
    pendingPill: 'Pending',
    donePill: 'Done',
    overduePill: 'Overdue',
    medicine: 'Medicine',
    appointment: 'Appointment',
    routine: 'Routine',
    reminder: 'Reminder',
    scheduledBy: 'Scheduled by',
    takenAction: '✅  Taken',
    partialAction: '💊  Partial',
    snoozeAction: '😴  Snooze',
    notTakenAction: '❌  Not Taken',
    yesITookIt: '✅  Yes, I took it!',
    logPartialDose: '💊  Log Partial Dose',
    addNote: 'Add a note (optional)',
    howMuch: 'How much did you take?',
    remindAgain: 'Remind me again in:',
    cancel: 'Cancel',

    // Profile
    profile: 'Profile',
    language: 'Language',
    english: 'English',
    nepali: 'नेपाली',
    switchLanguage: 'Switch Language',
  },

  ne: {
    // Dashboard
    goodMorning: 'शुभ प्रभात',
    goodAfternoon: 'शुभ दिउँसो',
    goodEvening: 'शुभ साँझ',
    nextMedication: 'अर्को औषधि',
    quickActions: 'छिटो कार्यहरू',
    logHealthData: 'स्वास्थ्य डेटा लग गर्नुस्',
    moodCheckin: 'मुड जाँच',
    viewMedications: 'औषधिहरू हेर्नुस्',
    recommendations: 'सिफारिसहरू',
    todaySummary: 'आजको सारांश',
    medications: 'औषधिहरू',
    taken: 'लिइयो',
    healthLogs: 'स्वास्थ्य लगहरू',
    entries: 'प्रविष्टिहरू',
    entry: 'प्रविष्टि',
    today: 'आज',
    mood: 'मुड',
    recordedToday: 'आज रेकर्ड गरियो',
    notRecorded: 'रेकर्ड गरिएन',
    onTrack: 'ठीक छ',
    pending: 'बाँकी छ',
    active: 'सक्रिय',
    none: 'केही छैन',
    done: 'भयो',
    monitor: 'निगरानी',
    pendingRequests: 'बाँकी अनुरोधहरू',
    wantsToMonitor: 'तपाईंको स्वास्थ्य निगरानी गर्न चाहन्छ',
    approve: '✓ स्वीकार गर्नुस्',
    reject: '✕ अस्वीकार गर्नुस्',
    connectionCode: 'तपाईंको जडान कोड',
    shareCode: 'परिवार वा डाक्टरसँग साझा गर्नुस्',
    due: 'बाँकी',
    featureComingSoon: 'सुविधा छिट्टै आउँदैछ!',

    // Health Log
    logHealth: 'स्वास्थ्य लग',
    history: 'इतिहास',
    selectMetric: 'स्वास्थ्य मापन छान्नुस्',
    enterValue: 'प्रविष्ट गर्नुस्',
    value: 'मान',
    notes: 'टिप्पणी',
    notesOptional: 'टिप्पणी (ऐच्छिक)',
    logHealthDataBtn: 'स्वास्थ्य डेटा लग गर्नुस्',
    saving: 'सुरक्षित गर्दैछ…',
    quickReference: '📋 छिटो सन्दर्भ',
    noHealthLogs: 'अहिलेसम्म कुनै स्वास्थ्य लग छैन',
    switchToLog: 'पहिलो रेकर्ड गर्न लग ट्याबमा जानुस्।',
    valueLooksGood: '✅ मान ठीक देखिन्छ',
    bloodPressure: 'रक्तचाप',
    bloodSugar: 'रगतको चिनी',
    weight: 'तौल',
    temperature: 'तापक्रम',
    heartRate: 'मुटुको गति',

    // Medications
    myMedications: 'मेरा औषधिहरू',
    noMedications: 'अहिलेसम्म कुनै औषधि तालिकाबद्ध छैन।',
    dueNow: '⏰ अहिले बाँकी',
    upcoming: '🔜 आउँदो',
    todaySchedule: '📅 आज',
    takenBtn: '✅ लिइयो',
    notTakenBtn: '❌ लिइएन',
    doctorPrescribed: 'डाक्टरले दिनुभएको — हेरचाहकर्ताको तालिका पर्खिँदैछ',
    noTimeSet: 'समय तोकिएको छैन',

    // Mood
    howAreYouFeeling: 'तपाईं कस्तो महसुस गर्दै हुनुहुन्छ?',
    checkinHelps: 'तपाईंको जाँचले तपाईंको हेरचाहकर्तालाई मद्दत गर्छ',
    happy: 'खुशी',
    neutral: 'सामान्य',
    sad: 'दुःखी',
    anxious: 'चिन्तित',
    tired: 'थकित',
    lonely: 'एक्लो',
    tellUsMore: 'थप बताउनुस् (ऐच्छिक)',
    submitCheckin: 'जाँच पेश गर्नुस्',
    recentCheckins: 'हालका जाँचहरू',
    noMoodYet: 'अहिलेसम्म कुनै मुड डेटा छैन।',
    moodRecorded: '✓ मुड रेकर्ड गरियो',
    caregiverNotified: '📱 तपाईंको हेरचाहकर्तालाई सूचित गरियो।',
    caregiverCanSee: 'तपाईंको हेरचाहकर्ताले यो जाँच जुनसुकै बेला हेर्न सक्नुहुन्छ।',
    concernScore: 'चिन्ता स्कोर',

    // Reminders
    todaysSchedule: 'आजको तालिका',
    nothingScheduled: 'आज केही तालिकाबद्ध छैन',
    nothingScheduledSub: 'तपाईंको हेरचाहकर्ताले अहिलेसम्म कुनै कार्य तालिकाबद्ध गर्नुभएको छैन।',
    overdue: 'ढिलो भयो',
    upcomingPill: 'आउँदो',
    pendingPill: 'बाँकी',
    donePill: 'भयो',
    overduePill: 'ढिलो',
    medicine: 'औषधि',
    appointment: 'भेटघाट',
    routine: 'दिनचर्या',
    reminder: 'सम्झाउने',
    scheduledBy: 'तालिकाबद्ध गर्नुभएको',
    takenAction: '✅  लिइयो',
    partialAction: '💊  आंशिक',
    snoozeAction: '😴  स्नुज',
    notTakenAction: '❌  लिइएन',
    yesITookIt: '✅  हो, मैले लिएँ!',
    logPartialDose: '💊  आंशिक मात्रा लग गर्नुस्',
    addNote: 'टिप्पणी थप्नुस् (ऐच्छिक)',
    howMuch: 'कति लिनुभयो?',
    remindAgain: 'फेरि सम्झाउने समय:',
    cancel: 'रद्द गर्नुस्',

    // Profile
    profile: 'प्रोफाइल',
    language: 'भाषा',
    english: 'English',
    nepali: 'नेपाली',
    switchLanguage: 'भाषा परिवर्तन गर्नुस्',
  },
};

export type TranslationKey = keyof typeof translations.en;

interface LanguageContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'en',
  setLang: () => {},
  t: (key) => translations.en[key],
});

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [lang, setLang] = useState<Lang>('en');
  const t = (key: TranslationKey): string => translations[lang][key] || translations.en[key];
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLang = () => useContext(LanguageContext);