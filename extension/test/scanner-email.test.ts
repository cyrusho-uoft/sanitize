import { describe, it, expect } from 'vitest';
import { emailPattern } from '../src/scanner/patterns/email';

describe('Email Pattern', () => {
  it('detects standard email', () => {
    const results = emailPattern.scan('Contact: john@example.com');
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('medium');
  });

  it('detects U of T email with high severity', () => {
    const results = emailPattern.scan('Email: john.smith@mail.utoronto.ca');
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('high');
    expect(results[0].explanationKey).toBe('email_uoft');
  });

  it('detects @utoronto.ca as high severity', () => {
    const results = emailPattern.scan('Contact: prof@utoronto.ca');
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('high');
  });

  it('detects @cs.toronto.edu as high severity', () => {
    const results = emailPattern.scan('Email: researcher@cs.toronto.edu');
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('high');
  });

  it('detects multiple emails', () => {
    const results = emailPattern.scan('john@gmail.com and jane@utoronto.ca');
    expect(results).toHaveLength(2);
    expect(results[0].severity).toBe('medium'); // gmail
    expect(results[1].severity).toBe('high');   // utoronto
  });

  it('does not match invalid email format', () => {
    const results = emailPattern.scan('not an email: @utoronto.ca');
    expect(results).toHaveLength(0);
  });
});
