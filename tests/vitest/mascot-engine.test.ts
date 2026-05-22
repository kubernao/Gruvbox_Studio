import { describe, expect, it } from 'vitest';
import { applyMascotEvent, tickMascotState } from '../../src/frontend/features/assistant/mascot/mascotEngine';
import { createDefaultMascotState } from '../../src/frontend/features/assistant/mascot/mascotState';

describe('mascot engine', () => {
  it('decreases vitals over time', () => {
    const start = 1_000_000;
    const initial = createDefaultMascotState(start);
    const result = tickMascotState(initial, start + 3_600_000);
    expect(result.state.happiness).toBeLessThan(initial.happiness);
    expect(result.state.energy).toBeLessThan(initial.energy);
  });

  it('hatches after enough successful prompts', () => {
    let state = createDefaultMascotState(1_000);
    state = applyMascotEvent(state, 'success', { now: 2_000 }).state;
    state = applyMascotEvent(state, 'success', { now: 3_000 }).state;
    const third = applyMascotEvent(state, 'success', { now: 4_000 }).state;
    expect(third.totalPrompts).toBe(3);
    expect(third.stage).toBe('hatchling');
    expect(third.hatchedAt).toBe(4_000);
  });

  it('pet and feed have cooldowns', () => {
    const start = 1_000;
    const initial = createDefaultMascotState(start);
    const firstPet = applyMascotEvent(initial, 'pet', { now: start + 1_000 });
    const secondPet = applyMascotEvent(firstPet.state, 'pet', { now: start + 1_500 });
    expect(secondPet.state.happiness).toBe(firstPet.state.happiness);

    const firstFeed = applyMascotEvent(initial, 'feed', { now: start + 1_000 });
    const secondFeed = applyMascotEvent(firstFeed.state, 'feed', { now: start + 10_000 });
    expect(secondFeed.state.energy).toBe(firstFeed.state.energy);
  });

  it('cycles through every stage and wraps to egg', () => {
    let state = createDefaultMascotState(1_000);
    const stageByBucket = ['egg', 'hatchling', 'kit', 'companion', 'sage', 'egg'] as const;

    for (let bucket = 0; bucket < stageByBucket.length; bucket += 1) {
      const targetPrompts = bucket * 3;
      while (state.totalPrompts < targetPrompts) {
        state = applyMascotEvent(state, 'success', { now: 2_000 + state.totalPrompts }).state;
      }
      expect(state.stage).toBe(stageByBucket[bucket]);
    }
  });
});
