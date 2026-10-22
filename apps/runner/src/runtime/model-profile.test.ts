import { describe, expect, it } from 'vitest';
import { runtimeModelProfile } from './model-profile.js';
describe('model execution provenance is assigned by the Runner configuration', () => {
  it('recognizes the configured live provider and excludes credentials from profile contents', () => {
    const live = runtimeModelProfile('https://api.deepseek.com/v1');
    expect(live.executionMode).toBe('live-mock'); expect(live.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(live.model).toMatchObject({ name: 'deepseek-v4-flash', temperature: 0 });
    expect(runtimeModelProfile('http://127.0.0.1:5555/v1').executionMode).toBe('simulated');
    expect(runtimeModelProfile('https://unregistered.example/v1').executionMode).toBe('unverified');
    expect(() => runtimeModelProfile('https://key:secret@api.deepseek.com/v1')).toThrow('MODEL_ENDPOINT_REJECTED');
    expect(() => runtimeModelProfile('https://api.deepseek.com/v1?api_key=secret')).toThrow('MODEL_ENDPOINT_REJECTED');
  });
});
