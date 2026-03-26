import { describe, it, expect } from 'vitest';
import { usernamePattern } from '../src/scanner/patterns/username';

describe('Username Pattern', () => {
  // @mention detection
  it('detects @mention', () => {
    const results = usernamePattern.scan('Message @sarah.chen on Teams');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('@sarah.chen');
    expect(results[0].type).toBe('username');
  });

  it('detects @mention with underscores', () => {
    const results = usernamePattern.scan('Check @john_smith_uoft for updates');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('@john_smith_uoft');
  });

  it('detects multiple @mentions', () => {
    const results = usernamePattern.scan('CC @alice and @bob on this thread');
    expect(results).toHaveLength(2);
  });

  it('does not detect @ in email addresses', () => {
    // The @ in an email is preceded by alphanumeric chars — should be skipped
    const results = usernamePattern.scan('email: john@utoronto.ca');
    // The mention regex should skip this because the char before @ is alphanumeric
    expect(results.filter(r => r.value === '@utoronto.ca')).toHaveLength(0);
  });

  // Profile URL detection
  it('detects GitHub profile URL', () => {
    const results = usernamePattern.scan('See https://github.com/cyrusho-uoft for the code');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('https://github.com/cyrusho-uoft');
  });

  it('detects LinkedIn profile URL', () => {
    const results = usernamePattern.scan('Profile: https://www.linkedin.com/in/sarah-chen-123');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('https://www.linkedin.com/in/sarah-chen-123');
  });

  it('detects Twitter/X profile URL', () => {
    const results = usernamePattern.scan('Follow https://x.com/prof_wong');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('https://x.com/prof_wong');
  });

  it('detects Instagram profile URL', () => {
    const results = usernamePattern.scan('Photo at https://instagram.com/uoft.student');
    expect(results).toHaveLength(1);
  });

  it('does not detect plain text without @ or URL', () => {
    const results = usernamePattern.scan('The user smithj12 logged in');
    expect(results).toHaveLength(0);
  });

  it('does not detect single character after @', () => {
    const results = usernamePattern.scan('Cost is @5 per unit');
    expect(results).toHaveLength(0);
  });
});
