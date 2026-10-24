import { LocalAudioTrack, Track } from "livekit-client";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useEffect } from "react";
import { VoiceSettings } from "../src/VoiceSettings";
import { usePreferences } from "../src/store";
import { useCapture } from "../src/devices";
import { applyMicrophoneEffect, voiceErrors } from "../src/voice";
import { VoiceProcessor } from "../src/voice-processor";
import {
  defaultVoiceSettings,
  voicePresets,
  type VoiceSettings as Settings,
} from "../src/voice-settings";
import "../src/styles.css";

const results = document.querySelector<HTMLPreElement>("#results")!;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const report = (text: string) => {
  results.textContent += `${text}\n`;
};
const assert: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message);
};
const rms = (data: Float32Array) =>
  Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));
const root = createRoot(document.querySelector("#controls")!);
function Controls({ track }: { track: LocalAudioTrack }) {
  const { microphone, setTracks } = useCapture();
  useEffect(() => {
    setTracks([track]);
  }, [track, setTracks]);
  return <VoiceSettings microphone={microphone} />;
}

button.onclick = async () => {
  button.disabled = true;
  results.textContent = "";
  const preferences = usePreferences.getState().voice;
  const context = new AudioContext({ sampleRate: 48000 });
  const oscillator = context.createOscillator(),
    volume = context.createGain();
  const destination = context.createMediaStreamDestination();
  oscillator.frequency.value = 1000;
  volume.gain.value = 0.2;
  oscillator.connect(volume).connect(destination);
  oscillator.start();
  await context.resume();
  const input = destination.stream.getAudioTracks()[0];
  const track = new LocalAudioTrack(input, undefined, true, context);
  track.source = Track.Source.Microphone;
  const peers: RTCPeerConnection[] = [];
  let noiseSource: AudioBufferSourceNode | undefined;
  const readers: MediaStreamAudioSourceNode[] = [];
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  const silence = context.createGain();
  silence.gain.value = 0;
  analyser.connect(silence).connect(context.destination);
  const read = (mediaTrack: MediaStreamTrack) => {
    for (const source of readers) source.disconnect();
    readers.length = 0;
    const source = context.createMediaStreamSource(new MediaStream([mediaTrack]));
    source.connect(analyser);
    readers.push(source);
  };
  const samples = new Float32Array(analyser.fftSize);
  const amplitude = () => {
    analyser.getFloatTimeDomainData(samples);
    return rms(samples);
  };
  const config = {
    ...defaultVoiceSettings,
    enabled: true,
    noiseReduction: false,
    leveling: false,
    expander: false,
    compression: 1,
    deEss: 0,
    warmth: 0,
    clarity: 0,
  };
  try {
    usePreferences.setState({ voice: config });
    await applyMicrophoneEffect(track);
    assert(
      track.getProcessor() instanceof VoiceProcessor,
      voiceErrors.get(track) || "Processor did not attach",
    );
    const first = track.getProcessor() as VoiceProcessor;
    read(track.mediaStreamTrack);
    await pause(500);
    assert(amplitude() > 0.08, "Processed speech-band tone is silent");
    report(`PASS actual AudioWorklet output: ${db(amplitude()).toFixed(1)} dBFS RMS`);

    volume.gain.value = 0.04;
    await pause(400);
    const quietLevel = amplitude();
    const normalization = {
      ...config,
      leveling: true,
      levelingAmount: 3,
      targetLufs: -23,
    };
    usePreferences.setState({ voice: normalization });
    await applyMicrophoneEffect(track);
    await pause(5500);
    assert(track.getProcessor() === first, "Normalization restarted microphone processing");
    assert(
      first.meters && first.meters.levelGainDb > 1.5 && first.meters.levelGainDb <= 3,
      "The worklet did not apply gentle bounded loudness normalization",
    );
    assert(amplitude() > quietLevel * 1.2, "Normalization did not lift the actual quiet output");
    usePreferences.setState({ voice: { ...normalization, levelingAmount: 1 } });
    await applyMicrophoneEffect(track);
    await pause(1600);
    assert(
      first.meters.levelGainDb > 0.9 && first.meters.levelGainDb < 1.2,
      "Changing the normalization amount did not reach the worklet",
    );
    usePreferences.setState({ voice: { ...normalization, levelingAmount: 0 } });
    await applyMicrophoneEffect(track);
    await pause(1600);
    assert(Math.abs(first.meters.levelGainDb) < 0.1, "Zero amount retained normalization gain");
    report(
      "PASS bounded normalization lifts actual quiet audio; live amount changes and zero apply without restarting capture",
    );

    usePreferences.setState({ voice: { ...config, gain: 6, ceiling: -3 } });
    await applyMicrophoneEffect(track);
    assert(
      track.getProcessor() === first,
      "Tone changes restarted capture or replaced the processor",
    );
    volume.gain.value = 2;
    await pause(400);
    analyser.getFloatTimeDomainData(samples);
    assert(
      Math.max(...samples.map(Math.abs)) <= 10 ** (-3 / 20) + 0.001,
      "Browser output exceeded the peak ceiling",
    );
    report("PASS live parameter changes and peak protection without restarting microphone capture");

    await track.mute();
    await pause(200);
    assert(amplitude() < 0.0001, "Mute leaked processed audio");
    await track.unmute();
    await pause(200);
    assert(amplitude() > 0.1, "Unmute did not restore processed audio");
    report("PASS processed microphone mute/unmute");

    // Actual sender replacement and decoded audio over a browser WebRTC connection.
    const sender = new RTCPeerConnection(),
      receiver = new RTCPeerConnection();
    peers.push(sender, receiver);
    const receiverTrack = new Promise<MediaStreamTrack>((resolve) => {
      receiver.ontrack = (e) => resolve(e.track);
    });
    sender.onicecandidate = (e) => {
      if (e.candidate) void receiver.addIceCandidate(e.candidate);
    };
    receiver.onicecandidate = (e) => {
      if (e.candidate) void sender.addIceCandidate(e.candidate);
    };
    track.sender = sender.addTrack(
      track.mediaStreamTrack,
      new MediaStream([track.mediaStreamTrack]),
    );
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(sender.localDescription!);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(receiver.localDescription!);
    const received = await Promise.race([
      receiverTrack,
      pause(5000).then(() => {
        throw new Error("WebRTC receive timed out");
      }),
    ]);
    const remotePlayer = document.createElement("audio");
    remotePlayer.muted = true;
    remotePlayer.srcObject = new MediaStream([received]);
    document.body.append(remotePlayer);
    await remotePlayer.play();
    read(received);
    await pause(800);
    assert(amplitude() > 0.05, "Receiver did not decode processed audio");
    report(
      `PASS processed microphone carried over WebRTC: received ${db(amplitude()).toFixed(1)} dBFS RMS`,
    );

    usePreferences.setState({ voice: { ...config, enabled: false } });
    await applyMicrophoneEffect(track);
    assert(
      !track.getProcessor() && first.context.state === "closed",
      "Bypass leaked its processing context",
    );
    volume.gain.value = 0.1;
    await pause(400);
    assert(
      amplitude() > 0.03 && amplitude() < 0.12,
      `Bypass broke remote audio: ${db(amplitude())} dBFS, context ${context.state}`,
    );
    report(
      "PASS bypass swaps the published sender to the original track and releases processing resources",
    );

    usePreferences.setState({ voice: config });
    await applyMicrophoneEffect(track);
    const processor = track.getProcessor() as VoiceProcessor;
    assert(processor instanceof VoiceProcessor, "Re-enabling failed");
    // The SDK invokes restart with a raw replacement and no audio context.
    const replacement = context.createMediaStreamDestination();
    volume.connect(replacement);
    await track.replaceTrack(replacement.stream.getAudioTracks()[0], true);
    await pause(300);
    assert(amplitude() > 0.02, "Device replacement lost remote audio");
    report("PASS SDK processor restart with a replacement source and omitted audioContext");

    // Seeded broadband fan-like noise tests RNNoise's actual WASM/worklet, not only its loader.
    const buffer = context.createBuffer(1, 48000 * 3, 48000);
    const noise = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < noise.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      noise[i] = ((seed / 4294967296) * 2 - 1) * 0.05;
    }
    noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    const noiseDestination = context.createMediaStreamDestination();
    noiseSource.connect(noiseDestination);
    noiseSource.start();
    await track.replaceTrack(noiseDestination.stream.getAudioTracks()[0], true);
    await pause(800);
    const before = amplitude();
    usePreferences.setState({ voice: { ...config, noiseReduction: true } });
    await applyMicrophoneEffect(track);
    const denoiser = track.getProcessor() as VoiceProcessor;
    assert(
      denoiser instanceof VoiceProcessor && denoiser.noiseReduction,
      voiceErrors.get(track) || "RNNoise did not attach",
    );
    await pause(1800);
    const after = amplitude();
    assert(after < before * 0.5, `RNNoise did not reduce noise: ${db(before)} -> ${db(after)}`);
    assert(
      denoiser.meters && Number.isFinite(denoiser.meters.outputDb),
      "DSP meter heartbeat stopped",
    );
    report(
      `PASS RNNoise WASM noise reduction over WebRTC: ${(db(before) - db(after)).toFixed(1)} dB`,
    );

    // A failed graph must restore raw sender audio instead of leaving a dead processed track.
    const node = (denoiser as unknown as { node: AudioWorkletNode }).node;
    node.dispatchEvent(new Event("processorerror"));
    const fallbackDeadline = Date.now() + 5000;
    while (track.getProcessor() && Date.now() < fallbackDeadline) await pause(50);
    assert(
      !track.getProcessor() && !!voiceErrors.get(track),
      `Processing failure did not restore the original sender track: ${voiceErrors.get(track) || "no diagnostic"}, context ${denoiser.context.state}`,
    );
    assert(
      track.sender.track === noiseDestination.stream.getAudioTracks()[0],
      "Failure fallback sender uses the wrong track",
    );
    report("PASS processor failure restores the raw sender track with a visible diagnostic");

    const addModule = AudioWorklet.prototype.addModule;
    try {
      AudioWorklet.prototype.addModule = async () => {
        throw new Error("Simulated unavailable audio asset");
      };
      await applyMicrophoneEffect(track);
      assert(
        !track.getProcessor() && voiceErrors.get(track)?.includes("unavailable audio asset"),
        "Startup asset failure silenced the microphone",
      );
    } finally {
      AudioWorklet.prototype.addModule = addModule;
    }
    report("PASS missing worklet assets retain the working raw microphone path");

    const cancelled = new LocalAudioTrack(input.clone(), undefined, true, context);
    const applying = applyMicrophoneEffect(cancelled);
    setTimeout(() => cancelled.stop(), 0);
    await applying;
    assert(!cancelled.getProcessor(), "Leaving during initialization retained a processing graph");
    report("PASS leaving while voice processing initializes releases its graph");
    usePreferences.setState({ voice: { ...defaultVoiceSettings, enabled: true } });
    await applyMicrophoneEffect(track);
    flushSync(() => root.render(<Controls track={track} />));
    const active = track.getProcessor() as VoiceProcessor;
    const applied: Settings[] = [];
    const update = active.update.bind(active);
    active.update = (settings) => {
      applied.push(settings);
      update(settings);
    };
    const select = () => document.querySelector<HTMLSelectElement>('[aria-label="Voice preset"]')!;
    for (const preset of voicePresets) {
      applied.length = 0;
      select().value = preset.id;
      flushSync(() => select().dispatchEvent(new Event("change", { bubbles: true })));
      const deadline = Date.now() + 2000;
      while (!applied.length && Date.now() < deadline) await pause(20);
      assert(select().value === preset.id, `${preset.label} reset to the placeholder`);
      assert(
        applied.at(-1)?.warmth === preset.settings.warmth &&
          applied.at(-1)?.clarity === preset.settings.clarity,
        `${preset.label} did not reach the live processor`,
      );
      assert(track.getProcessor() === active, "Changing presets replaced the processing graph");
    }
    flushSync(() => root.render(null));
    await usePreferences.persist.rehydrate();
    flushSync(() => root.render(<Controls track={track} />));
    assert(select().value === "warm", "Reopening settings lost the saved preset");
    flushSync(() =>
      usePreferences.getState().set({
        voice: { ...usePreferences.getState().voice, gain: -2 },
      }),
    );
    assert(select().value === "", "Manual adjustments retained a misleading preset label");
    const amount = () =>
      document.querySelector<HTMLInputElement>('[aria-label="Normalization amount"]')!;
    assert(amount().value === "3", "The normalization control lost its gentle default");
    applied.length = 0;
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
      .set!;
    flushSync(() => {
      setInputValue.call(amount(), "1.5");
      amount().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const amountDeadline = Date.now() + 2000;
    while (
      !applied.some((settings) => settings.levelingAmount === 1.5) &&
      Date.now() < amountDeadline
    )
      await pause(20);
    assert(
      usePreferences.getState().voice.levelingAmount === 1.5 &&
        applied.some((settings) => settings.levelingAmount === 1.5) &&
        track.getProcessor() === active,
      "Normalization amount did not persist and reach the existing processor from the slider",
    );
    await usePreferences.persist.rehydrate();
    flushSync(() => root.render(<Controls track={track} />));
    assert(amount().value === "1.5", "The normalization amount was lost after storage reload");
    const normalizationSwitch = document.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Loudness normalization"]',
    )!;
    flushSync(() => normalizationSwitch.click());
    assert(
      !usePreferences.getState().voice.leveling && amount().disabled,
      "Switching normalization off did not disable its amount control",
    );
    report(
      "PASS normalization slider and switch update the live processor and retain the saved amount",
    );
    flushSync(() => usePreferences.getState().set({ voice: { ...voicePresets[1].settings } }));
    active.update = update;
    report(
      "PASS preset selection stays visible, reaches the live processor through useCapture, survives reopening and storage reload, and recognizes custom settings",
    );
    report("PASS controls ready for before/after sample recording; ALL AUDIO CHECKS PASSED");
  } catch (error) {
    report(`FAIL ${error instanceof Error ? error.stack : error}`);
  } finally {
    // Keep this generated input alive for the explicit browser UI comparison check.
    button.disabled = false;
    button.textContent = "Run checks again (reload first)";
    window.addEventListener(
      "pagehide",
      () => {
        root.unmount();
        track.stop();
        for (const peer of peers) peer.close();
        noiseSource?.stop();
        oscillator.stop();
        void context.close();
        usePreferences.setState({ voice: preferences });
      },
      { once: true },
    );
  }
};
