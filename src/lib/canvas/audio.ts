"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AudioFeatures = {
	bass: number;
	mid: number;
	high: number;
	level: number;
	beat: number;
};

export const SILENT: AudioFeatures = {
	bass: 0,
	mid: 0,
	high: 0,
	level: 0,
	beat: 0,
};

/** True when nothing should move (no track playing / no signal). */
export function isStill(features: AudioFeatures): boolean {
	return (
		features.bass === 0 &&
		features.mid === 0 &&
		features.high === 0 &&
		features.level === 0 &&
		features.beat === 0
	);
}

type BeatState = {
	prevEnergy: number;
	riseAvg: number;
	last: number;
	value: number;
	frames: number;
};

/**
 * Loads an audio file and exposes per-frame spectrum features for the render
 * loop. `sample()` reads the analyser at call time (never React state).
 */
export function useAudio() {
	const contextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const bufferRef = useRef<AudioBuffer | null>(null);
	const sourceRef = useRef<AudioBufferSourceNode | null>(null);
	const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
	const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
	const beatRef = useRef<BeatState>({
		prevEnergy: 0,
		riseAvg: 0,
		last: 0,
		value: 0,
		frames: 0,
	});

	const [isPlaying, setIsPlaying] = useState(false);
	const [trackName, setTrackName] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const ensureContext = useCallback(() => {
		if (!contextRef.current) {
			const context = new AudioContext();
			const analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0.5;
			analyser.connect(context.destination);
			contextRef.current = context;
			analyserRef.current = analyser;
			dataRef.current = new Uint8Array(analyser.frequencyBinCount);
			// Time-domain buffer for onset detection: unlike the frequency data
			// it is not affected by `smoothingTimeConstant`.
			timeDataRef.current = new Uint8Array(analyser.fftSize);
		}
		return contextRef.current;
	}, []);

	const stopSource = useCallback(() => {
		const source = sourceRef.current;
		if (!source) return;
		source.onended = null;
		try {
			source.stop();
		} catch {
			// Source already stopped.
		}
		source.disconnect();
		sourceRef.current = null;
	}, []);

	const load = useCallback(
		async (file: File) => {
			try {
				setError(null);
				const context = ensureContext();
				const arrayBuffer = await file.arrayBuffer();
				bufferRef.current = await context.decodeAudioData(arrayBuffer);
				setTrackName(file.name);
			} catch {
				bufferRef.current = null;
				setTrackName(null);
				setError("Could not decode that audio file.");
			}
		},
		[ensureContext],
	);

	// Same as `load`, but for a bundled demo track served from `/public`.
	const loadUrl = useCallback(
		async (url: string, name: string) => {
			try {
				setError(null);
				const context = ensureContext();
				const response = await fetch(url);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const arrayBuffer = await response.arrayBuffer();
				bufferRef.current = await context.decodeAudioData(arrayBuffer);
				setTrackName(name);
			} catch {
				bufferRef.current = null;
				setTrackName(null);
				setError("Could not load that track.");
			}
		},
		[ensureContext],
	);

	const play = useCallback(async () => {
		const context = ensureContext();
		const buffer = bufferRef.current;
		if (!buffer) return;
		if (context.state === "suspended") await context.resume();

		stopSource();
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(analyserRef.current as AnalyserNode);
		source.onended = () => {
			if (sourceRef.current === source) {
				sourceRef.current = null;
				setIsPlaying(false);
			}
		};
		source.start();
		sourceRef.current = source;
		beatRef.current = {
			prevEnergy: 0,
			riseAvg: 0,
			last: performance.now(),
			value: 0,
			frames: 0,
		};
		setIsPlaying(true);
	}, [ensureContext, stopSource]);

	const pause = useCallback(() => {
		stopSource();
		setIsPlaying(false);
	}, [stopSource]);

	const sample = useCallback((): AudioFeatures => {
		const analyser = analyserRef.current;
		const data = dataRef.current;
		const context = contextRef.current;
		if (!analyser || !data || !context || !sourceRef.current) return SILENT;

		analyser.getByteFrequencyData(data);
		const perBin = context.sampleRate / 2 / data.length;

		let bass = 0;
		let mid = 0;
		let high = 0;
		let level = 0;
		let bassCount = 0;
		let midCount = 0;
		let highCount = 0;

		for (let i = 0; i < data.length; i++) {
			// Gamma curve: exaggerate dynamics so quiet passages settle and hits
			// pop, instead of everything sitting near a constant mid-level.
			const value = (data[i] / 255) ** 1.4;
			level += value;
			const hz = i * perBin;
			if (hz < 250) {
				bass += value;
				bassCount++;
			} else if (hz < 2000) {
				mid += value;
				midCount++;
			} else if (hz < 8000) {
				high += value;
				highCount++;
			}
		}

		const features: AudioFeatures = {
			bass: bassCount ? bass / bassCount : 0,
			mid: midCount ? mid / midCount : 0,
			high: highCount ? high / highCount : 0,
			level: level / data.length,
			beat: 0,
		};

		// Onset detection from the raw waveform. The frequency data is smoothed,
		// and on a loud sustained track `bass` sits within a hair of its own
		// average, so a level-ratio test can never fire (measured: zero beats in
		// three seconds). A rise in short-term energy can still fire.
		const timeData = timeDataRef.current;
		let energy = 0;
		if (timeData) {
			analyser.getByteTimeDomainData(timeData);
			let sum = 0;
			for (let i = 0; i < timeData.length; i++) {
				const v = (timeData[i] - 128) / 128;
				sum += v * v;
			}
			energy = Math.sqrt(sum / timeData.length);
		}

		const beat = beatRef.current;
		beat.frames += 1;
		const rise = Math.max(0, energy - beat.prevEnergy);
		beat.prevEnergy = energy;
		beat.riseAvg = beat.riseAvg * 0.92 + rise * 0.08;
		beat.value *= 0.8;
		const now = performance.now();
		if (
			beat.frames > 40 &&
			rise > Math.max(0.02, beat.riseAvg * 2.2) &&
			now - beat.last > 180
		) {
			beat.value = 1;
			beat.last = now;
		}
		features.beat = beat.value;
		return features;
	}, []);

	useEffect(() => {
		return () => {
			stopSource();
			contextRef.current?.close();
			contextRef.current = null;
		};
	}, [stopSource]);

	return {
		load,
		loadUrl,
		play,
		pause,
		sample,
		isPlaying,
		trackName,
		error,
		hasTrack: trackName !== null,
	};
}
