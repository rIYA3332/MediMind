// components/VitalChart.tsx
// npm install react-native-chart-kit react-native-svg

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { colors } from '../styles/colors';

const SW = Dimensions.get('window').width;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TrendPoint {
  value: number;
  label: string;
  systolic?: number | null;
  diastolic?: number | null;
}

interface VitalChartProps {
  data: TrendPoint[];
  logType: string;
  unit: string;
  compact?: boolean;
  themeColor?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
export const VITAL_COLORS: Record<string, string> = {
  blood_pressure: '#e17055',
  blood_sugar:    '#6c5ce7',
  heart_rate:     '#ff4757',
  temperature:    '#fd79a8',
  weight:         '#00b894',
};

const NORMAL_RANGES: Record<string, { min: number; max: number }> = {
  blood_pressure: { min: 90,  max: 140 },
  blood_sugar:    { min: 70,  max: 140 },
  heart_rate:     { min: 60,  max: 100 },
  temperature:    { min: 97,  max: 99  },
  weight:         { min: 0,   max: 999 },
};

// ─── SparklineChart ───────────────────────────────────────────────────────────
export const SparklineChart: React.FC<{
  data: TrendPoint[];
  logType: string;
  width?: number;
  height?: number;
}> = ({ data, logType, width = 90, height = 44 }) => {
  const color = VITAL_COLORS[logType] || colors.primary;
  const vals = useMemo(
    () => (data || []).map(d => d.value).filter(v => typeof v === 'number' && !isNaN(v) && v > 0),
    [data],
  );

  if (vals.length < 2) {
    return <View style={{ width, height, backgroundColor: '#f5f5f5', borderRadius: 6 }} />;
  }

  return (
    <LineChart
      data={{ labels: [], datasets: [{ data: vals }] }}
      width={width}
      height={height}
      withDots={false}
      withInnerLines={false}
      withOuterLines={false}
      withHorizontalLabels={false}
      withVerticalLabels={false}
      bezier
      chartConfig={{
        backgroundGradientFrom: '#ffffff',
        backgroundGradientTo:   '#ffffff',
        decimalPlaces: 0,
        color: () => color,
        strokeWidth: 2,
        propsForBackgroundLines: { strokeWidth: 0 },
      }}
      style={{ paddingRight: 0 }}
    />
  );
};

// ─── VitalChart (main) ────────────────────────────────────────────────────────
const VitalChart: React.FC<VitalChartProps> = ({
  data, logType, unit, compact = false, themeColor,
}) => {
  const color = themeColor || VITAL_COLORS[logType] || colors.primary;
  const range = NORMAL_RANGES[logType];
  const isBP  = logType === 'blood_pressure';

  const filtered = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (isBP) {
      return data.filter(d => d.systolic != null && !isNaN(Number(d.systolic)));
    }
    return data.filter(d => typeof d.value === 'number' && !isNaN(d.value) && d.value > 0);
  }, [data, logType]);

  if (filtered.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Not enough data</Text>
        <Text style={styles.emptySub}>Log at least 2 readings to see the chart</Text>
      </View>
    );
  }

  const maxLabels = compact ? 3 : 6;
  const step      = Math.max(1, Math.floor(filtered.length / maxLabels));
  const labels    = filtered.map((d, i) => (i % step === 0 ? d.label : ''));

  const chartW = Math.max(
    compact ? SW - 80 : SW - 48,
    filtered.length * (compact ? 28 : 48),
  );
  const chartH = compact ? 100 : 180;

  // For BP we show two lines; chart-kit supports multiple datasets
  const datasets = isBP
    ? [
        {
          data:        filtered.map(d => Number(d.systolic)  || 0),
          color:       () => '#e17055',
          strokeWidth: 2.5,
        },
        {
          data:        filtered.map(d => Number(d.diastolic) || 0),
          color:       () => '#74b9ff',
          strokeWidth: 2,
        },
      ]
    : [
        {
          data:        filtered.map(d => d.value),
          color:       () => color,
          strokeWidth: 2.5,
        },
      ];

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <LineChart
          data={{ labels, datasets }}
          width={chartW}
          height={chartH}
          withDots={!compact}
          withInnerLines={!compact}
          withOuterLines={false}
          withHorizontalLabels={!compact}
          withVerticalLabels={!compact}
          bezier
          chartConfig={{
            backgroundGradientFrom: '#fafafa',
            backgroundGradientTo:   '#ffffff',
            decimalPlaces: 0,
            color:      () => color,
            labelColor: () => '#888888',
            propsForDots: {
              r:           compact ? '0' : '4',
              strokeWidth: '2',
              stroke:      color,
            },
            propsForBackgroundLines: {
              stroke:      '#eeeeee',
              strokeWidth: 1,
            },
          }}
          style={styles.chart}
        />
      </ScrollView>

      {!compact && range && range.min > 0 && (
        <View style={styles.rangeRow}>
          <View style={[styles.rangeBox, { backgroundColor: '#00b89428' }]} />
          <Text style={styles.rangeText}>
            Normal: {range.min}–{range.max} {unit}{isBP ? ' (systolic)' : ''}
          </Text>
        </View>
      )}

      {!compact && isBP && (
        <View style={styles.legendRow}>
          {[['#e17055', 'Systolic'], ['#74b9ff', 'Diastolic']].map(([c, l]) => (
            <View key={l} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: c }]} />
              <Text style={styles.legendText}>{l}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

// ─── MedAdherenceChart ────────────────────────────────────────────────────────
export const MedAdherenceChart: React.FC<{
  dailyData: Array<{ day: string; taken: number; missed: number }>;
}> = ({ dailyData }) => {
  if (!dailyData || dailyData.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No medication data</Text>
      </View>
    );
  }

  const labels = dailyData.map(d => {
    const dt = new Date(d.day);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });
  const takenVals  = dailyData.map(d => Math.max(0, d.taken  || 0));
  const missedVals = dailyData.map(d => Math.max(0, d.missed || 0));

  return (
    <View>
      <BarChart
        data={{ labels, datasets: [{ data: takenVals }] }}
        width={SW - 48}
        height={160}
        yAxisLabel=""
        yAxisSuffix=""
        fromZero
        showValuesOnTopOfBars={false}
        chartConfig={{
          backgroundGradientFrom: '#fafafa',
          backgroundGradientTo:   '#ffffff',
          decimalPlaces: 0,
          color:      () => '#00b894',
          labelColor: () => '#888888',
          propsForBackgroundLines: { stroke: '#eeeeee' },
        }}
        style={styles.chart}
      />
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#00b894' }]} />
          <Text style={styles.legendText}>Taken ({takenVals.reduce((a, b) => a + b, 0)})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#ff7675' }]} />
          <Text style={styles.legendText}>Missed ({missedVals.reduce((a, b) => a + b, 0)})</Text>
        </View>
      </View>
    </View>
  );
};

// ─── MoodBarChart ─────────────────────────────────────────────────────────────
export const MoodBarChart: React.FC<{
  moodData: Array<{ mood: string; count: number }>;
}> = ({ moodData }) => {
  if (!moodData || moodData.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No mood data</Text>
      </View>
    );
  }

  const MOOD_COLORS: Record<string, string> = {
    happy: '#00b894', neutral: '#74b9ff', sad: '#ff7675',
    anxious: '#fdcb6e', tired: '#a29bfe', lonely: '#fd79a8',
  };
  const MOOD_EMOJI: Record<string, string> = {
    happy: '😊', neutral: '😐', sad: '😢', anxious: '😰', tired: '😴', lonely: '🪑',
  };

  const labels = moodData.map(m => MOOD_EMOJI[m.mood] || m.mood.slice(0, 3));
  const values = moodData.map(m => Math.max(0, m.count));

  return (
    <View>
      <BarChart
        data={{ labels, datasets: [{ data: values }] }}
        width={SW - 48}
        height={160}
        yAxisLabel=""
        yAxisSuffix=""
        fromZero
        showValuesOnTopOfBars
        chartConfig={{
          backgroundGradientFrom: '#fafafa',
          backgroundGradientTo:   '#ffffff',
          decimalPlaces: 0,
          color:      () => '#74b9ff',
          labelColor: () => '#888888',
          propsForBackgroundLines: { stroke: '#eeeeee' },
        }}
        style={styles.chart}
      />
      <View style={[styles.legendRow, { flexWrap: 'wrap' }]}>
        {moodData.map(m => (
          <View key={m.mood} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: MOOD_COLORS[m.mood] || '#ccc' }]} />
            <Text style={styles.legendText}>{MOOD_EMOJI[m.mood] || m.mood} ({m.count})</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  chart:       { borderRadius: 10, marginVertical: 4 },
  empty:       { minHeight: 80, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fafafa', paddingHorizontal: 20 },
  emptyTitle:  { fontSize: 13, color: '#aaa', textAlign: 'center' },
  emptySub:    { fontSize: 11, color: '#bbb', marginTop: 4, textAlign: 'center' },
  rangeRow:    { flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingHorizontal: 4 },
  rangeBox:    { width: 14, height: 8, borderRadius: 3, marginRight: 6 },
  rangeText:   { fontSize: 11, color: '#888' },
  legendRow:   { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 6 },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot:         { width: 10, height: 10, borderRadius: 5 },
  legendText:  { fontSize: 11, color: '#666' },
});

export default VitalChart;