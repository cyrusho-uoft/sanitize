import { PatternDefinition } from './types';
import { sinPattern } from './patterns/sin';
import { studentNumberPattern } from './patterns/student-number';
import { healthCardPattern } from './patterns/health-card';
import { emailPattern } from './patterns/email';
import { phonePattern } from './patterns/phone';
import { creditCardPattern } from './patterns/credit-card';
import { utoridPattern } from './patterns/utorid';
import { usernamePattern } from './patterns/username';

/** All registered L1 patterns, ordered by priority (highest first) */
export const patterns: PatternDefinition[] = [
  sinPattern,
  healthCardPattern,
  creditCardPattern,
  studentNumberPattern,
  utoridPattern,
  emailPattern,
  usernamePattern,
  phonePattern,
].sort((a, b) => b.priority - a.priority);
