export type Severity = 'high' | 'medium' | 'low';
export type Layer = 'L1' | 'L2';

export interface Detection {
  type: string;
  value: string;
  start: number;
  end: number;
  severity: Severity;
  layer: Layer;
  confidence: number;
  explanationKey: string;
}

export interface PatternDefinition {
  type: string;
  severity: Severity;
  explanationKey: string;
  /** Priority for merge deduplication — higher wins when spans overlap */
  priority: number;
  /** Find all matches in the given text */
  scan(text: string): Detection[];
}

/** Type priority order for merge (higher = wins overlap) */
export const TYPE_PRIORITY: Record<string, number> = {
  sin: 100,
  health_card: 90,
  credit_card: 80,
  student_number: 70,
  employee_id: 60,
  utorid: 50,
  email: 40,
  phone: 30,
};
