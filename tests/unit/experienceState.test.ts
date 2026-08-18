import { describe, expect, it, vi } from 'vitest';
import {
  ExperienceMachine,
  holdsChoiceFrame,
  isBranchPlaying,
  isBranchReveal,
} from '../../src/app/ExperienceState.ts';

function atChoice(): ExperienceMachine {
  const machine = new ExperienceMachine();
  machine.transition('ready');
  machine.transition('intro');
  machine.transition('choice');
  return machine;
}

describe('ExperienceMachine — transition table', () => {
  it('starts in boot and only accepts ready', () => {
    const machine = new ExperienceMachine();
    expect(machine.state).toBe('boot');
    expect(machine.transition('choice')).toBe(false);
    expect(machine.transition('ready')).toBe(true);
  });

  it('reports invalid transitions instead of throwing', () => {
    const onInvalidTransition = vi.fn();
    const machine = new ExperienceMachine({ onInvalidTransition });
    expect(machine.transition('red-playing')).toBe(false);
    expect(onInvalidTransition).toHaveBeenCalledWith('boot', 'red-playing');
    expect(machine.state).toBe('boot');
  });

  it('lets a visitor scroll back out of choice into the intro', () => {
    const machine = atChoice();
    expect(machine.transition('intro')).toBe(true);
    expect(machine.transition('choice')).toBe(true);
  });

  it('notifies subscribers and can be unsubscribed', () => {
    const machine = new ExperienceMachine();
    const listener = vi.fn();
    const off = machine.subscribe(listener);
    machine.transition('ready');
    expect(listener).toHaveBeenCalledWith({ from: 'boot', to: 'ready', branch: null });
    off();
    machine.transition('intro');
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('ExperienceMachine — selection is single-shot', () => {
  it('cannot select RED and BLUE at the same time', () => {
    const machine = atChoice();
    expect(machine.commitSelection('blue')).toBe(true);
    expect(machine.branch).toBe('blue');
    expect(machine.commitSelection('red')).toBe(false);
    expect(machine.branch).toBe('blue');
    expect(machine.state).toBe('branch-loading');
  });

  it('ignores a second activation of the same hotspot (double tap)', () => {
    const machine = atChoice();
    expect(machine.commitSelection('red')).toBe(true);
    expect(machine.commitSelection('red')).toBe(false);
    expect(machine.state).toBe('branch-loading');
  });

  it('refuses to commit outside choice', () => {
    const machine = new ExperienceMachine();
    machine.transition('ready');
    expect(machine.commitSelection('red')).toBe(false);
    expect(machine.selectionCommitted).toBe(false);
  });

  it('starts playback only for the committed branch', () => {
    const machine = atChoice();
    machine.commitSelection('red');
    expect(machine.beginPlayback()).toBe(true);
    expect(machine.state).toBe('red-playing');
    expect(isBranchPlaying(machine.state)).toBe(true);
  });
});

describe('ExperienceMachine — playback completion', () => {
  it('ignores an `ended` event from the film that is not on screen', () => {
    const machine = atChoice();
    machine.commitSelection('blue');
    machine.beginPlayback();
    expect(machine.completePlayback('red')).toBe(false);
    expect(machine.state).toBe('blue-playing');
    expect(machine.completePlayback('blue')).toBe(true);
    expect(machine.state).toBe('blue-reveal');
    expect(isBranchReveal(machine.state)).toBe(true);
  });

  it('can reveal without playback when the branch video is unavailable', () => {
    const machine = atChoice();
    machine.commitSelection('red');
    expect(machine.revealWithoutPlayback()).toBe(true);
    expect(machine.state).toBe('red-reveal');
  });

  it('can fall all the way back to choice when a branch cannot load', () => {
    const machine = atChoice();
    machine.commitSelection('red');
    expect(machine.abandonSelection()).toBe(true);
    expect(machine.state).toBe('choice');
    expect(machine.selectionCommitted).toBe(false);
    expect(machine.branch).toBe(null);
  });
});

describe('ExperienceMachine — choose again', () => {
  it('always lands back on choice with the lock released', () => {
    for (const branch of ['red', 'blue'] as const) {
      const machine = atChoice();
      machine.commitSelection(branch);
      machine.beginPlayback();
      machine.completePlayback(branch);
      expect(machine.chooseAgain()).toBe(true);
      expect(machine.state).toBe('returning');
      expect(machine.arriveAtChoice()).toBe(true);
      expect(machine.state).toBe('choice');
      expect(machine.branch).toBe(null);
      expect(machine.selectionCommitted).toBe(false);
      // …and the other branch is now selectable.
      expect(machine.commitSelection(branch === 'red' ? 'blue' : 'red')).toBe(true);
    }
  });

  it('does not allow returning straight from playback', () => {
    const machine = atChoice();
    machine.commitSelection('red');
    machine.beginPlayback();
    expect(machine.chooseAgain()).toBe(false);
    expect(machine.state).toBe('red-playing');
  });
});

describe('ExperienceMachine — reduced motion', () => {
  it('skips the scrubbed intro and goes straight to choice', () => {
    const machine = new ExperienceMachine({ motion: 'reduced' });
    expect(machine.prefersReducedMotion).toBe(true);
    machine.transition('ready');
    expect(machine.transition('choice')).toBe(true);
    expect(machine.state).toBe('choice');
  });

  it('still reaches the reveal and the CTA without playing a film', () => {
    const machine = new ExperienceMachine({ motion: 'reduced' });
    machine.transition('ready');
    machine.transition('choice');
    machine.commitSelection('blue');
    expect(machine.revealWithoutPlayback()).toBe(true);
    expect(machine.state).toBe('blue-reveal');
    machine.chooseAgain();
    expect(machine.arriveAtChoice()).toBe(true);
  });
});

describe('state predicates', () => {
  it('identifies the states that must hold the exact CHOICE frame', () => {
    expect(holdsChoiceFrame('choice')).toBe(true);
    expect(holdsChoiceFrame('branch-loading')).toBe(true);
    expect(holdsChoiceFrame('returning')).toBe(true);
    expect(holdsChoiceFrame('intro')).toBe(false);
    expect(holdsChoiceFrame('red-playing')).toBe(false);
  });
});
