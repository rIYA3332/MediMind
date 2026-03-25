// screens/caregiver/ScheduleManagerScreen.tsx
import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

// ─────────────────────────── types ───────────────────────────────────────────
type ScheduleType = 'medicine' | 'appointment' | 'routine' | 'reminder';
interface Elder    { id: number; name: string; relationship: string; }
interface Schedule {
  id: number; elder_id: number; elder_name: string;
  type: string; title: string; description?: string; dosage?: string;
  scheduled_time: string; scheduled_days: string[];
  start_date: string; end_date?: string;
  repeat_interval: number; max_reminders: number; is_active: boolean;
}
interface FormState {
  elderId: number; type: ScheduleType; title: string;
  description: string; dosage: string; scheduledTime: string;
  scheduledDays: string[]; startDate: string; endDate: string;
  repeatInterval: number; maxReminders: number;
}

// ─────────────────────────── constants ───────────────────────────────────────
const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  medicine:    { icon: '💊', color: '#a29bfe', label: 'Medicine'    },
  appointment: { icon: '🏥', color: '#74b9ff', label: 'Appointment' },
  routine:     { icon: '🌿', color: '#00b894', label: 'Routine'     },
  reminder:    { icon: '🔔', color: '#fdcb6e', label: 'Reminder'    },
  // server may return these aliases
  medication:  { icon: '💊', color: '#a29bfe', label: 'Medicine'    },
  task:        { icon: '📋', color: '#fdcb6e', label: 'Task'        },
};

// ── Safe lookup — NEVER returns undefined ─────────────────────────────────
const DEFAULT_CFG = { icon: '📋', color: '#636e72', label: 'Schedule' };
const getTypeCfg  = (type?: string | null) =>
  (type && TYPE_CONFIG[type]) ? TYPE_CONFIG[type] : DEFAULT_CFG;

const FORM_TYPES: ScheduleType[] = ['medicine', 'appointment', 'routine', 'reminder'];

const ALL_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TIMES = Array.from({ length: 24 }, (_, h) =>
  [`${String(h).padStart(2,'0')}:00`, `${String(h).padStart(2,'0')}:30`]
).flat();

// ─────────────────────────── helpers ─────────────────────────────────────────
const fmtTime = (t?: string | null): string => {
  if (!t || !t.includes(':')) return '';
  const parts = t.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const todayISO = () => new Date().toISOString().split('T')[0];

const parseCustomTime = (raw: string): string | null => {
  const s = raw.trim();
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = parseInt(hhmm[1]), m = parseInt(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2] ? parseInt(ampm[2]) : 0;
    const period = ampm[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  const plain = s.match(/^(\d{3,4})$/);
  if (plain) {
    const padded = s.padStart(4, '0');
    const h = parseInt(padded.slice(0, 2)), m = parseInt(padded.slice(2));
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  return null;
};

// =============================================================================
// TIME PICKER
// =============================================================================
interface TimePickerProps {
  visible: boolean;
  selectedTime: string;
  onSelect: (t: string) => void;
  onClose: () => void;
}
const TimePicker = memo(({ visible, selectedTime, onSelect, onClose }: TimePickerProps) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const applyCustom = () => {
    const parsed = parseCustomTime(input);
    if (!parsed) { setError('Enter a valid time like "9:15 AM", "14:30", or "0930"'); return; }
    setError(''); setInput(''); onSelect(parsed);
  };
  const applyPreset = (t: string) => { setInput(''); setError(''); onSelect(t); };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={S.tpOverlay}>
        <View style={S.tpBox}>
          <Text style={S.tpTitle}>Select Reminder Time</Text>

          <View style={S.customTimeWrap}>
            <Text style={S.customTimeLabel}>⌨️  Enter a custom time</Text>
            <View style={S.customTimeRow}>
              <TextInput
                style={[S.customTimeInput, error ? S.customTimeInputError : null]}
                value={input}
                onChangeText={v => { setInput(v); setError(''); }}
                placeholder='e.g. 9:15 AM  or  14:30  or  0930'
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={applyCustom}
              />
              <TouchableOpacity style={S.customTimeBtn} onPress={applyCustom}>
                <Text style={S.customTimeBtnTxt}>Set</Text>
              </TouchableOpacity>
            </View>
            {error
              ? <Text style={S.customTimeErrorTxt}>⚠️ {error}</Text>
              : <Text style={S.customTimeHint}>Accepts: "9:15 AM", "14:30", "0930"</Text>}
          </View>

          <View style={S.tpDivider}>
            <View style={S.tpDividerLine} />
            <Text style={S.tpDividerTxt}>or pick a preset</Text>
            <View style={S.tpDividerLine} />
          </View>

          <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator>
            {TIMES.map(t => (
              <TouchableOpacity key={t}
                style={[S.tpItem, selectedTime === t && S.tpItemOn]}
                onPress={() => applyPreset(t)}>
                <Text style={[S.tpItemTxt, selectedTime === t && S.tpItemOnTxt]}>{fmtTime(t)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={S.tpClose} onPress={onClose}>
            <Text style={S.tpCloseTxt}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
});

// =============================================================================
// FORM MODAL
// =============================================================================
interface FormModalProps {
  visible: boolean;
  editItem: Schedule | null;
  elders: Elder[];
  form: FormState;
  saving: boolean;
  onChangeForm: (updates: Partial<FormState>) => void;
  onSave: () => void;
  onClose: () => void;
}
const FormModal = memo(({ visible, editItem, elders, form, saving, onChangeForm, onSave, onClose }: FormModalProps) => {
  const [showTimePicker, setShowTimePicker] = useState(false);

  const toggleDay = useCallback((day: string) => {
    if (day === 'daily') { onChangeForm({ scheduledDays: ['daily'] }); return; }
    const days = form.scheduledDays.filter(d => d !== 'daily');
    onChangeForm({ scheduledDays: days.includes(day) ? days.filter(d => d !== day) : [...days, day] });
  }, [form.scheduledDays, onChangeForm]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={S.formWrap}>
        <View style={S.formBar}>
          <TouchableOpacity onPress={onClose}>
            <Text style={S.fCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={S.fTitle}>{editItem ? 'Edit Schedule' : 'New Schedule'}</Text>
          <TouchableOpacity onPress={onSave} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={S.fSave}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView style={S.fBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* elder */}
          {!editItem && (
            <View style={S.fSection}>
              <Text style={S.fLabel}>For Elder *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={S.row}>
                  {elders.map(e => (
                    <TouchableOpacity key={e.id}
                      style={[S.chip, form.elderId === e.id && S.chipOn]}
                      onPress={() => onChangeForm({ elderId: e.id })}>
                      <Text style={[S.chipTxt, form.elderId === e.id && S.chipOnTxt]}>{e.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* type */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Type *</Text>
            <View style={S.typeGrid}>
              {FORM_TYPES.map(t => {
                const c = getTypeCfg(t);
                return (
                  <TouchableOpacity key={t}
                    style={[S.typeBtn, form.type === t && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                    onPress={() => onChangeForm({ type: t, dosage: t !== 'medicine' ? '' : form.dosage })}>
                    <Text style={S.typeBtnIco}>{c.icon}</Text>
                    <Text style={[S.typeBtnTxt, form.type === t && { color: c.color, fontWeight: '700' }]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* title */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Title *</Text>
            <TextInput style={S.input} value={form.title}
              onChangeText={v => onChangeForm({ title: v })}
              placeholder={
                form.type === 'medicine'    ? 'e.g. Metformin 500mg' :
                form.type === 'appointment' ? 'e.g. Dr. Sharma – Cardiology' :
                form.type === 'routine'     ? 'e.g. Morning Walk 30 min' :
                'e.g. Drink 2 glasses of water'
              }
              placeholderTextColor={colors.textSecondary}
              returnKeyType="next" />
          </View>

          {/* dosage — medicine only */}
          {form.type === 'medicine' && (
            <View style={S.fSection}>
              <Text style={S.fLabel}>Dosage / Instructions</Text>
              <TextInput style={S.input} value={form.dosage}
                onChangeText={v => onChangeForm({ dosage: v })}
                placeholder="e.g. 1 tablet after food"
                placeholderTextColor={colors.textSecondary}
                returnKeyType="next" />
            </View>
          )}

          {/* notes */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Notes</Text>
            <TextInput style={[S.input, { height: 80, textAlignVertical: 'top' }]}
              value={form.description}
              onChangeText={v => onChangeForm({ description: v })}
              placeholder="Any extra instructions for the elder…"
              placeholderTextColor={colors.textSecondary}
              multiline />
          </View>

          {/* time */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Reminder Time *</Text>
            <TouchableOpacity style={S.timeBtn} onPress={() => setShowTimePicker(true)}>
              <Text style={S.timeBtnIco}>🕐</Text>
              <Text style={[S.timeBtnTxt, !form.scheduledTime && { color: colors.textSecondary, fontWeight: '400' }]}>
                {form.scheduledTime ? fmtTime(form.scheduledTime) : 'Tap to set a time…'}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textSecondary }}>▼</Text>
            </TouchableOpacity>
          </View>

          {/* days */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Repeat</Text>
            <View style={S.row}>
              <TouchableOpacity
                style={[S.chip, form.scheduledDays.includes('daily') && S.chipOn]}
                onPress={() => toggleDay('daily')}>
                <Text style={[S.chipTxt, form.scheduledDays.includes('daily') && S.chipOnTxt]}>Every Day</Text>
              </TouchableOpacity>
              {!form.scheduledDays.includes('daily') && ALL_DAYS.map(d => (
                <TouchableOpacity key={d}
                  style={[S.dayChip, form.scheduledDays.includes(d) && S.dayChipOn]}
                  onPress={() => toggleDay(d)}>
                  <Text style={[S.dayChipTxt, form.scheduledDays.includes(d) && S.dayChipOnTxt]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {form.scheduledDays.includes('daily') && (
              <TouchableOpacity onPress={() => onChangeForm({ scheduledDays: [] })} style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: colors.primary }}>Or choose specific days →</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* dates */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Start Date *</Text>
            <TextInput style={S.input} value={form.startDate}
              onChangeText={v => onChangeForm({ startDate: v })}
              placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
          </View>
          <View style={S.fSection}>
            <Text style={S.fLabel}>End Date <Text style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</Text></Text>
            <TextInput style={S.input} value={form.endDate}
              onChangeText={v => onChangeForm({ endDate: v })}
              placeholder="YYYY-MM-DD  (leave blank = ongoing)"
              placeholderTextColor={colors.textSecondary} />
          </View>

          {/* reminder settings */}
          <View style={S.fSection}>
            <Text style={S.fLabel}>Reminder Settings</Text>
            <View style={S.settingsBox}>
              <View style={S.settingsRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.settingsKey}>Re-remind every</Text>
                  <Text style={S.settingsHint}>Minutes between reminders</Text>
                </View>
                <View style={S.stepper}>
                  <TouchableOpacity style={S.stepBtn}
                    onPress={() => onChangeForm({ repeatInterval: Math.max(5, form.repeatInterval - 5) })}>
                    <Text style={S.stepBtnTxt}>−</Text>
                  </TouchableOpacity>
                  <Text style={S.stepVal}>{form.repeatInterval} min</Text>
                  <TouchableOpacity style={S.stepBtn}
                    onPress={() => onChangeForm({ repeatInterval: Math.min(120, form.repeatInterval + 5) })}>
                    <Text style={S.stepBtnTxt}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={[S.settingsRow, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={S.settingsKey}>Max reminders</Text>
                  <Text style={S.settingsHint}>Stop after this many attempts</Text>
                </View>
                <View style={S.stepper}>
                  <TouchableOpacity style={S.stepBtn}
                    onPress={() => onChangeForm({ maxReminders: Math.max(1, form.maxReminders - 1) })}>
                    <Text style={S.stepBtnTxt}>−</Text>
                  </TouchableOpacity>
                  <Text style={S.stepVal}>{form.maxReminders}×</Text>
                  <TouchableOpacity style={S.stepBtn}
                    onPress={() => onChangeForm({ maxReminders: Math.min(10, form.maxReminders + 1) })}>
                    <Text style={S.stepBtnTxt}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            <Text style={S.reminderNote}>
              💡 Elder will be notified at {fmtTime(form.scheduledTime) || '(no time set)'}, then every {form.repeatInterval} mins up to {form.maxReminders} times if no response.
            </Text>
          </View>

          <View style={{ height: 60 }} />
        </ScrollView>

        <TimePicker
          visible={showTimePicker}
          selectedTime={form.scheduledTime}
          onSelect={t => { onChangeForm({ scheduledTime: t }); setShowTimePicker(false); }}
          onClose={() => setShowTimePicker(false)}
        />
      </SafeAreaView>
    </Modal>
  );
});

// =============================================================================
// MAIN SCREEN
// =============================================================================
const ScheduleManagerScreen = ({ navigation }: any) => {
  const [caregiver,   setCaregiver]   = useState<any>(null);
  const [elders,      setElders]      = useState<Elder[]>([]);
  const [schedules,   setSchedules]   = useState<Schedule[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [filterElder, setFilterElder] = useState<number | null>(null);
  const [filterType,  setFilterType]  = useState<string>('all');
  const [showForm,    setShowForm]    = useState(false);
  const [editItem,    setEditItem]    = useState<Schedule | null>(null);

  const blankForm = useCallback((defaultElderId = 0): FormState => ({
    elderId: defaultElderId, type: 'medicine', title: '',
    description: '', dosage: '', scheduledTime: '',
    scheduledDays: ['daily'], startDate: todayISO(), endDate: '',
    repeatInterval: 30, maxReminders: 3,
  }), []);

  const [form, setForm] = useState<FormState>(blankForm());

  const handleFormChange = useCallback((updates: Partial<FormState>) => {
    setForm(prev => ({ ...prev, ...updates }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          setCaregiver(user);
          await loadData(user.id);
        }
      } catch (e) { console.log('Init error', e); }
      finally { setLoading(false); }
    })();
  }, []);

  const loadData = useCallback(async (cgId: number) => {
    try {
      const [er, sr] = await Promise.all([
        fetch(getApiUrl(`/api/connections/${cgId}`)),
        fetch(getApiUrl(`/api/schedules/caregiver/${cgId}`)),
      ]);
      const [ed, sd] = await Promise.all([er.json(), sr.json()]);
      setElders(Array.isArray(ed) ? ed : []);
      setSchedules(Array.isArray(sd) ? sd : []);
    } catch (e) { console.log('Load error', e); }
    finally { setRefreshing(false); }
  }, []);

  const onRefresh = () => { setRefreshing(true); if (caregiver?.id) loadData(caregiver.id); };

  const save = async () => {
    if (!form.title.trim())              return Alert.alert('Missing', 'Please enter a title.');
    if (!form.elderId)                   return Alert.alert('Missing', 'Please select an elder.');
    if (!form.scheduledTime)             return Alert.alert('Missing', 'Please set a reminder time.');
    if (form.scheduledDays.length === 0) return Alert.alert('Missing', 'Select at least one day.');
    setSaving(true);
    try {
      const url    = editItem ? `/api/schedules/${editItem.id}` : '/api/schedules';
      const method = editItem ? 'PUT' : 'POST';
      const res = await fetch(getApiUrl(url), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elderId: form.elderId, caregiverId: caregiver.id,
          type: form.type, title: form.title.trim(),
          description: form.description.trim() || null,
          dosage: form.type === 'medicine' ? (form.dosage.trim() || null) : null,
          scheduledTime: form.scheduledTime.length === 5 ? form.scheduledTime + ':00' : form.scheduledTime,
          scheduledDays: form.scheduledDays,
          startDate: form.startDate, endDate: form.endDate || null,
          repeatInterval: form.repeatInterval, maxReminders: form.maxReminders,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) return Alert.alert('Error', data.message);
      Alert.alert('✅ Saved', editItem ? 'Schedule updated.' : 'Schedule created! Elder will be notified.');
      setShowForm(false); setEditItem(null);
      await loadData(caregiver.id);
    } catch { Alert.alert('Error', 'Failed to save. Please try again.'); }
    finally { setSaving(false); }
  };

  const remove = (id: number, title: string) =>
    Alert.alert('Remove Schedule', `Remove "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
          await fetch(getApiUrl(`/api/schedules/${id}`), { method: 'DELETE' });
          await loadData(caregiver.id);
      }},
    ]);

  const openCreate = () => {
    setEditItem(null);
    setForm(blankForm(filterElder || elders[0]?.id || 0));
    setShowForm(true);
  };

  const openEdit = (s: Schedule) => {
    setEditItem(s);
    setForm({
      elderId: s.elder_id,
      type: (s.type as ScheduleType) || 'medicine',
      title: s.title,
      description: s.description || '',
      dosage: s.dosage || '',
      scheduledTime: (s.scheduled_time || '').slice(0, 5),
      scheduledDays: s.scheduled_days || ['daily'],
      startDate: s.start_date || todayISO(),
      endDate: s.end_date || '',
      repeatInterval: s.repeat_interval || 30,
      maxReminders: s.max_reminders || 3,
    });
    setShowForm(true);
  };

  const filtered = schedules.filter(s =>
    (!filterElder || s.elder_id === filterElder) &&
    (filterType === 'all' || s.type === filterType)
  );

  const grouped: Record<string, Schedule[]> = {};
  filtered.forEach(s => {
    const k = `${s.elder_id}:${s.elder_name || 'Unknown'}`;
    grouped[k] = grouped[k] ? [...grouped[k], s] : [s];
  });

  return (
    <SafeAreaView style={S.screen}>

      <View style={S.header}>
        <View>
          <Text style={S.headerSup}>Caregiver</Text>
          <Text style={S.headerTitle}>Schedule Manager</Text>
        </View>
        <TouchableOpacity
          style={[S.newBtn, elders.length === 0 && { opacity: 0.4 }]}
          onPress={openCreate} disabled={elders.length === 0}>
          <Text style={S.newBtnTxt}>＋ New</Text>
        </TouchableOpacity>
      </View>

      {/* Stats bar — only show the 4 form types */}
      <View style={S.statsBar}>
        {FORM_TYPES.map(t => {
          const c = getTypeCfg(t);
          const cnt = schedules.filter(s => s.type === t || (t === 'medicine' && s.type === 'medication')).length;
          return (
            <TouchableOpacity key={t} style={S.statBox}
              onPress={() => setFilterType(filterType === t ? 'all' : t)}>
              <View style={[S.statIconWrap, { backgroundColor: c.color + '22', borderColor: filterType === t ? c.color : 'transparent' }]}>
                <Text style={{ fontSize: 20 }}>{c.icon}</Text>
              </View>
              <Text style={[S.statNum, { color: c.color }]}>{cnt}</Text>
              <Text style={S.statLbl}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {elders.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.elderFilterBar}>
          <View style={S.row}>
            <TouchableOpacity style={[S.chip, filterElder === null && S.chipOn]} onPress={() => setFilterElder(null)}>
              <Text style={[S.chipTxt, filterElder === null && S.chipOnTxt]}>All Elders</Text>
            </TouchableOpacity>
            {elders.map(e => (
              <TouchableOpacity key={e.id}
                style={[S.chip, filterElder === e.id && S.chipOn]}
                onPress={() => setFilterElder(filterElder === e.id ? null : e.id)}>
                <Text style={[S.chipTxt, filterElder === e.id && S.chipOnTxt]}>👤 {e.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={S.loadTxt}>Loading schedules…</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          {elders.length === 0 && (
            <View style={S.empty}>
              <Text style={S.emptyIco}>👥</Text>
              <Text style={S.emptyTitle}>No elders connected</Text>
              <Text style={S.emptyTxt}>Connect to an elder first before scheduling reminders.</Text>
            </View>
          )}

          {elders.length > 0 && Object.keys(grouped).length === 0 && (
            <View style={S.empty}>
              <Text style={S.emptyIco}>📅</Text>
              <Text style={S.emptyTitle}>No schedules yet</Text>
              <Text style={S.emptyTxt}>Tap "+ New" to create the first reminder for an elder.</Text>
            </View>
          )}

          {Object.entries(grouped).map(([key, items]) => {
            const elderName = key.split(':').slice(1).join(':');
            return (
              <View key={key}>
                <View style={S.elderHdr}>
                  <View style={S.elderHdrLeft}>
                    <Text style={S.elderHdrIco}>👤</Text>
                    <Text style={S.elderHdrName}>{elderName}</Text>
                  </View>
                  <Text style={S.elderHdrCnt}>{items.length} schedule{items.length !== 1 ? 's' : ''}</Text>
                </View>

                {items.map(s => {
                  // ── SAFE lookup — never crashes even with unknown type ──
                  const c = getTypeCfg(s.type);
                  return (
                    <View key={s.id} style={[S.card, { borderLeftColor: c.color }]}>
                      <View style={S.cardTop}>
                        <View style={[S.typePill, { backgroundColor: c.color + '18' }]}>
                          <Text style={[S.typePillTxt, { color: c.color }]}>{c.icon} {c.label}</Text>
                        </View>
                        <View style={S.cardActions}>
                          <TouchableOpacity style={S.iconBtn} onPress={() => openEdit(s)}>
                            <Text style={{ fontSize: 17 }}>✏️</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={S.iconBtn} onPress={() => remove(s.id, s.title)}>
                            <Text style={{ fontSize: 17 }}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      <Text style={S.cardTitle}>{s.title}</Text>
                      {s.dosage      && <Text style={S.cardDosage}>💊 {s.dosage}</Text>}
                      {s.description && <Text style={S.cardDesc}>{s.description}</Text>}
                      <View style={S.cardMeta}>
                        <View style={S.metaItem}>
                          <Text style={S.metaIco}>🕐</Text>
                          <Text style={S.metaTxt}>{fmtTime(s.scheduled_time) || '—'}</Text>
                        </View>
                        <View style={S.metaItem}>
                          <Text style={S.metaIco}>📅</Text>
                          <Text style={S.metaTxt}>
                            {(s.scheduled_days || []).includes('daily') ? 'Every day' : (s.scheduled_days || []).join(', ') || '—'}
                          </Text>
                        </View>
                        <View style={S.metaItem}>
                          <Text style={S.metaIco}>🔔</Text>
                          <Text style={S.metaTxt}>×{s.max_reminders} / {s.repeat_interval}m</Text>
                        </View>
                      </View>
                      <View style={S.cardDateRow}>
                        <Text style={S.cardDate}>From: {s.start_date || '—'}</Text>
                        {s.end_date
                          ? <Text style={[S.cardDate, { color: '#e17055' }]}>Until: {s.end_date}</Text>
                          : <Text style={[S.cardDate, { color: '#00b894' }]}>Ongoing</Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <FormModal
        visible={showForm}
        editItem={editItem}
        elders={elders}
        form={form}
        saving={saving}
        onChangeForm={handleFormChange}
        onSave={save}
        onClose={() => { setShowForm(false); setEditItem(null); }}
      />
    </SafeAreaView>
  );
};

// ─────────────────────────── styles ──────────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, paddingBottom:14, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  headerSup:   { fontSize:11, color:colors.textSecondary, textTransform:'uppercase', letterSpacing:0.6 },
  headerTitle: { fontSize:22, fontWeight:'800', color:colors.textPrimary, marginTop:2 },
  newBtn:    { backgroundColor:colors.primary, paddingHorizontal:18, paddingVertical:9, borderRadius:22 },
  newBtnTxt: { color:'#fff', fontSize:14, fontWeight:'700' },

  statsBar:     { flexDirection:'row', backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border, paddingVertical:12 },
  statBox:      { flex:1, alignItems:'center' },
  statIconWrap: { width:44, height:44, borderRadius:22, justifyContent:'center', alignItems:'center', marginBottom:4, borderWidth:2 },
  statNum:      { fontSize:18, fontWeight:'800' },
  statLbl:      { fontSize:10, color:colors.textSecondary, marginTop:1 },

  elderFilterBar: { backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border, maxHeight:52 },
  row:          { flexDirection:'row', flexWrap:'wrap', gap:8, paddingHorizontal:16, paddingVertical:10 },
  chip:         { paddingHorizontal:14, paddingVertical:6, borderRadius:20, borderWidth:1, borderColor:colors.border, backgroundColor:colors.white },
  chipOn:       { backgroundColor:colors.primary, borderColor:colors.primary },
  chipTxt:      { fontSize:13, color:colors.textSecondary, fontWeight:'500' },
  chipOnTxt:    { color:'#fff', fontWeight:'700' },
  dayChip:      { width:46, height:46, borderRadius:23, borderWidth:1, borderColor:colors.border, justifyContent:'center', alignItems:'center', backgroundColor:colors.white },
  dayChipOn:    { backgroundColor:colors.primary, borderColor:colors.primary },
  dayChipTxt:   { fontSize:11, fontWeight:'600', color:colors.textSecondary },
  dayChipOnTxt: { color:'#fff' },

  center:     { flex:1, justifyContent:'center', alignItems:'center' },
  loadTxt:    { marginTop:12, color:colors.textSecondary },
  empty:      { alignItems:'center', paddingVertical:70, paddingHorizontal:40 },
  emptyIco:   { fontSize:70, marginBottom:16 },
  emptyTitle: { fontSize:18, fontWeight:'700', color:colors.textPrimary, marginBottom:8 },
  emptyTxt:   { fontSize:13, color:colors.textSecondary, textAlign:'center', lineHeight:20 },

  elderHdr:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:10, backgroundColor:'#f0f3fa' },
  elderHdrLeft: { flexDirection:'row', alignItems:'center', gap:8 },
  elderHdrIco:  { fontSize:16 },
  elderHdrName: { fontSize:14, fontWeight:'700', color:colors.textPrimary },
  elderHdrCnt:  { fontSize:12, color:colors.textSecondary },

  card:       { backgroundColor:colors.white, marginHorizontal:16, marginBottom:10, marginTop:2, borderRadius:14, padding:14, borderLeftWidth:5, elevation:2, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:2} },
  cardTop:    { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  typePill:   { paddingHorizontal:10, paddingVertical:4, borderRadius:10 },
  typePillTxt:{ fontSize:11, fontWeight:'700' },
  cardActions:{ flexDirection:'row', gap:2 },
  iconBtn:    { padding:6 },
  cardTitle:  { fontSize:16, fontWeight:'800', color:colors.textPrimary, marginBottom:3 },
  cardDosage: { fontSize:12, color:'#a29bfe', marginBottom:3, fontWeight:'600' },
  cardDesc:   { fontSize:12, color:colors.textSecondary, marginBottom:8, lineHeight:17 },
  cardMeta:   { flexDirection:'row', flexWrap:'wrap', gap:10, marginTop:6 },
  metaItem:   { flexDirection:'row', alignItems:'center', gap:3 },
  metaIco:    { fontSize:12 },
  metaTxt:    { fontSize:11, color:colors.textSecondary },
  cardDateRow:{ flexDirection:'row', justifyContent:'space-between', marginTop:8, paddingTop:8, borderTopWidth:1, borderTopColor:colors.border },
  cardDate:   { fontSize:11, color:colors.textSecondary },

  formWrap: { flex:1, backgroundColor:colors.background },
  formBar:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  fTitle:   { fontSize:17, fontWeight:'700', color:colors.textPrimary },
  fCancel:  { fontSize:15, color:colors.textSecondary },
  fSave:    { fontSize:15, color:colors.primary, fontWeight:'700' },
  fBody:    { flex:1, padding:16 },
  fSection: { marginBottom:22 },
  fLabel:   { fontSize:11, fontWeight:'700', color:colors.textSecondary, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 },
  input:    { borderWidth:1, borderColor:colors.border, borderRadius:12, paddingHorizontal:14, paddingVertical:12, fontSize:14, color:colors.textPrimary, backgroundColor:colors.white },

  typeGrid:   { flexDirection:'row', flexWrap:'wrap', gap:10 },
  typeBtn:    { width:'47%', padding:14, borderRadius:14, borderWidth:1.5, borderColor:colors.border, alignItems:'center', backgroundColor:colors.white },
  typeBtnIco: { fontSize:28, marginBottom:4 },
  typeBtnTxt: { fontSize:13, color:colors.textSecondary, fontWeight:'600' },

  timeBtn:    { flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:colors.border, borderRadius:12, paddingHorizontal:14, paddingVertical:13, backgroundColor:colors.white, gap:10 },
  timeBtnIco: { fontSize:20 },
  timeBtnTxt: { flex:1, fontSize:16, fontWeight:'700', color:colors.textPrimary },

  settingsBox:  { backgroundColor:colors.white, borderRadius:12, padding:14, borderWidth:1, borderColor:colors.border },
  settingsRow:  { flexDirection:'row', alignItems:'center' },
  settingsKey:  { fontSize:13, fontWeight:'600', color:colors.textPrimary },
  settingsHint: { fontSize:11, color:colors.textSecondary, marginTop:1 },
  stepper:      { flexDirection:'row', alignItems:'center', gap:10 },
  stepBtn:      { width:34, height:34, borderRadius:17, borderWidth:1.5, borderColor:colors.primary, justifyContent:'center', alignItems:'center' },
  stepBtnTxt:   { fontSize:20, color:colors.primary, lineHeight:22 },
  stepVal:      { fontSize:14, fontWeight:'700', color:colors.textPrimary, minWidth:52, textAlign:'center' },
  reminderNote: { fontSize:12, color:colors.textSecondary, marginTop:10, lineHeight:18, fontStyle:'italic' },

  tpOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end' },
  tpBox:     { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, maxHeight:'85%' },
  tpTitle:   { fontSize:16, fontWeight:'700', color:colors.textPrimary, textAlign:'center', marginBottom:14 },

  customTimeWrap:       { backgroundColor:'#f8f9ff', borderRadius:14, padding:12, marginBottom:14, borderWidth:1, borderColor:colors.border },
  customTimeLabel:      { fontSize:12, fontWeight:'700', color:colors.textSecondary, marginBottom:8 },
  customTimeRow:        { flexDirection:'row', gap:8 },
  customTimeInput:      { flex:1, borderWidth:1.5, borderColor:colors.border, borderRadius:10, paddingHorizontal:12, paddingVertical:10, fontSize:15, color:colors.textPrimary, backgroundColor:colors.white },
  customTimeInputError: { borderColor:'#e17055' },
  customTimeBtn:        { backgroundColor:colors.primary, paddingHorizontal:18, borderRadius:10, justifyContent:'center', alignItems:'center' },
  customTimeBtnTxt:     { color:'#fff', fontSize:14, fontWeight:'700' },
  customTimeHint:       { fontSize:11, color:colors.textSecondary, marginTop:6 },
  customTimeErrorTxt:   { fontSize:11, color:'#e17055', marginTop:6, fontWeight:'600' },

  tpDivider:     { flexDirection:'row', alignItems:'center', gap:8, marginBottom:10 },
  tpDividerLine: { flex:1, height:1, backgroundColor:colors.border },
  tpDividerTxt:  { fontSize:11, color:colors.textSecondary, fontWeight:'600' },

  tpItem:     { paddingVertical:13, paddingHorizontal:16, borderRadius:8 },
  tpItemOn:   { backgroundColor:colors.primary },
  tpItemTxt:  { fontSize:15, color:colors.textPrimary, textAlign:'center', fontWeight:'500' },
  tpItemOnTxt:{ color:'#fff', fontWeight:'700' },
  tpClose:    { marginTop:10, backgroundColor:colors.primary, borderRadius:14, paddingVertical:13, alignItems:'center' },
  tpCloseTxt: { fontSize:15, fontWeight:'700', color:'#fff' },
});

export default ScheduleManagerScreen;