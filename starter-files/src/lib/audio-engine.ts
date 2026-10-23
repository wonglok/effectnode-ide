/**
 * Small WebAudio engine. There are no audio files in this starter: the click
 * and the ambient pad are synthesised, so the page stays self-contained.
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

  /** Short, quiet confirmation when the visitor navigates a chapter. */
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
