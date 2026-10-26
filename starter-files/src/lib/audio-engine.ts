/**
 * Small WebAudio engine. There are no audio files in this starter: the
 * per-chapter entrance cues and the ambient pad are synthesised, so the page
 * stays self-contained.
 *
 * Browsers only allow audio after a gesture, so Landing calls `start()` on the
 * first pointerdown. Until then every method is a no-op.
 */
class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private pad: GainNode | null = null;
  private padVoices: OscillatorNode[] = [];
  private soundFx = true;
  private music = false;

  async start(options: { soundFx: boolean; music: boolean }) {
    this.soundFx = options.soundFx;
    this.music = options.music;

    if (!this.context) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;

      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = 0.8;
      master.connect(context.destination);

      this.context = context;
      this.master = master;
      this.buildPad(context, master);
    }

    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => {});
    }
    this.applyMusic();
  }

  private buildPad(context: AudioContext, master: GainNode) {
    const pad = context.createGain();
    pad.gain.value = 0;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;

    pad.connect(filter);
    filter.connect(master);

    // A soft open fifth: two low sines plus an octave shimmer.
    const voices = [
      { frequency: 110, gain: 0.05 },
      { frequency: 164.81, gain: 0.032 },
      { frequency: 220, gain: 0.018 },
    ];

    this.padVoices = voices.map((voice) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = voice.frequency;
      oscillator.detune.value = (Math.random() - 0.5) * 5;

      const gain = context.createGain();
      gain.gain.value = voice.gain;

      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lfoGain = context.createGain();
      lfoGain.gain.value = voice.gain * 0.45;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start();

      oscillator.connect(gain);
      gain.connect(pad);
      oscillator.start();
      return oscillator;
    });

    this.pad = pad;
  }

  private applyMusic() {
    if (!this.context || !this.pad) return;
    const now = this.context.currentTime;
    const target = this.music ? 0.55 : 0;
    this.pad.gain.cancelScheduledValues(now);
    this.pad.gain.setTargetAtTime(target, now, 0.8);
  }

  setMusic(enabled: boolean) {
    this.music = enabled;
    if (this.context) this.applyMusic();
  }

  setSoundFx(enabled: boolean) {
    this.soundFx = enabled;
  }

  /** Short, quiet confirmation used by explicit preview actions. */
  playUiClick() {
    if (!this.context || !this.master || !this.soundFx) return;
    const context = this.context;
    const now = context.currentTime;

    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(560, now + 0.09);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
  }

  /** One synthesized envelope per note; timbre comes from type + filter. */
  private tone(options: {
    frequency: number;
    to?: number;
    at?: number;
    duration?: number;
    gain?: number;
    type?: OscillatorType;
    detune?: number;
    filterFrom?: number;
    filterTo?: number;
  }) {
    if (!this.context || !this.master) return;
    const context = this.context;
    const {
      frequency,
      to,
      at = 0,
      duration = 0.7,
      gain: peak = 0.05,
      type = 'sine',
      detune = 0,
      filterFrom,
      filterTo,
    } = options;
    const start = context.currentTime + at;

    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (to !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, to),
        start + duration * 0.8
      );
    }
    oscillator.detune.value = detune;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    if (filterFrom !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(filterFrom, start);
      filter.frequency.exponentialRampToValueAtTime(
        filterTo ?? filterFrom,
        start + duration * 0.9
      );
      gain.connect(filter);
      filter.connect(this.master);
    } else {
      gain.connect(this.master);
    }

    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  /** Filtered noise burst for airy, less tonal cues. */
  private noise(options: {
    at?: number;
    duration?: number;
    gain?: number;
    from: number;
    to: number;
    q?: number;
  }) {
    if (!this.context || !this.master) return;
    const context = this.context;
    const { at = 0, duration = 0.8, gain: peak = 0.03, from, to, q = 1.2 } =
      options;
    const start = context.currentTime + at;

    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * duration),
      context.sampleRate
    );
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + duration * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.05);
  }

  /**
   * A distinct synthesized signature for each chapter, played when that
   * chapter becomes the active scene. Quiet and short: a cue, not a fanfare.
   */
  playSceneEntrance(index: number) {
    if (!this.context || !this.master || !this.soundFx) return;

    switch (index) {
      case 0:
        // Soft Room — a warm major third in the sunlit room.
        this.tone({ frequency: 261.63, duration: 0.7, gain: 0.028 });
        this.tone({
          frequency: 523.25,
          duration: 0.8,
          gain: 0.05,
          type: "triangle",
        });
        this.tone({ frequency: 659.25, at: 0.07, duration: 0.9, gain: 0.038 });
        break;
      case 1:
        // Force Shield — a charged sweep opening into a bright shimmer.
        this.tone({
          frequency: 140,
          to: 340,
          duration: 0.5,
          gain: 0.045,
          type: "sawtooth",
          filterFrom: 700,
          filterTo: 2600,
        });
        this.tone({ frequency: 1200, at: 0.1, duration: 0.45, gain: 0.02 });
        break;
      case 2:
        // Kinetic — a quick three-note sparkle.
        [880, 1174.66, 1567.98].forEach((frequency, note) =>
          this.tone({
            frequency,
            at: note * 0.06,
            duration: 0.28,
            gain: 0.03,
            type: "triangle",
          })
        );
        break;
      case 3:
        // Apartment — woody marimba notes over a soft room thump.
        this.tone({ frequency: 98, to: 62, duration: 0.3, gain: 0.038 });
        this.tone({
          frequency: 392,
          duration: 0.35,
          gain: 0.048,
          type: "triangle",
        });
        this.tone({
          frequency: 587.33,
          at: 0.085,
          duration: 0.5,
          gain: 0.036,
          type: "triangle",
        });
        break;
      case 4:
        // Live Env — an airy swell over a low city hum.
        this.noise({ duration: 0.9, gain: 0.032, from: 320, to: 2200, q: 0.7 });
        this.tone({ frequency: 146.83, duration: 0.9, gain: 0.034 });
        break;
      default:
        // Alpha 6 — a crystalline bell cluster, slightly detuned.
        this.tone({ frequency: 1046.5, duration: 1.1, gain: 0.032, detune: -6 });
        this.tone({
          frequency: 1567.98,
          at: 0.05,
          duration: 0.9,
          gain: 0.024,
          detune: 8,
        });
        this.tone({ frequency: 2093, at: 0.12, duration: 0.7, gain: 0.016 });
        break;
    }
  }

  dispose() {
    this.padVoices.forEach((voice) => voice.stop());
    this.padVoices = [];
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.pad = null;
  }
}

export const audioEngine = new AudioEngine();
