/**
 * Timelapse capture + encode, in the HUD renderer.
 *
 * `desktopCapturer` streams and WebCodecs only exist in a renderer, so the main process asks this
 * module to record and receives the finished WebM bytes back.
 *
 * The timelapse is produced by *re-timing*: a frame is drawn every `intervalMs` of real time, but
 * stamped as if it were `1000 / fps` milliseconds after the previous one. At the defaults
 * (1 fps capture, 30 fps output) one minute of work becomes two seconds of video. MediaRecorder
 * cannot do this — it always stamps frames at wall-clock time.
 */
import { ArrayBufferTarget, Muxer } from 'webm-muxer';

export interface BeginPayload {
  sourceId: string;
  filename: string;
  intervalMs: number;
  fps: number;
  maxWidth: number;
  bitrate: number;
}

interface Session {
  stream: MediaStream;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  encoder: VideoEncoder;
  muxer: Muxer<ArrayBufferTarget>;
  target: ArrayBufferTarget;
  timer: number;
  frames: number;
  fps: number;
}

let session: Session | null = null;

const CODEC = 'vp09.00.10.08';

export function isRecording(): boolean {
  return session !== null;
}

export async function beginRecording(payload: BeginPayload): Promise<void> {
  if (session) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // Electron's desktop capture constraints (not in the DOM typings).
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: payload.sourceId,
        maxWidth: payload.maxWidth,
        maxFrameRate: 30,
      },
    } as unknown as MediaTrackConstraints,
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => {
      video.onloadeddata = () => resolve();
    });
  }

  const width = video.videoWidth || payload.maxWidth;
  const height = video.videoHeight || Math.round((payload.maxWidth * 9) / 16);

  const support = await VideoEncoder.isConfigSupported({
    codec: CODEC,
    width,
    height,
    bitrate: payload.bitrate,
    framerate: payload.fps,
  });
  if (!support.supported) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('This build cannot encode VP9 — recording is unavailable.');
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP9', width, height, frameRate: payload.fps },
    firstTimestampBehavior: 'offset',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      window.electronAPI?.recordingFailed?.(String((err as Error)?.message || err));
    },
  });
  encoder.configure({ codec: CODEC, width, height, bitrate: payload.bitrate, framerate: payload.fps, latencyMode: 'quality' });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D context for recording.');

  const frameDurationUs = Math.round(1_000_000 / payload.fps);
  let frames = 0;

  const capture = () => {
    if (!session) return;
    ctx.drawImage(video, 0, 0, width, height);
    const frame = new VideoFrame(canvas, {
      timestamp: frames * frameDurationUs,
      duration: frameDurationUs,
    });
    // A keyframe every two seconds of output keeps seeking usable without bloating the file.
    encoder.encode(frame, { keyFrame: frames % Math.max(1, payload.fps * 2) === 0 });
    frame.close();
    frames++;
    if (session) session.frames = frames;
  };

  session = {
    stream,
    video,
    canvas,
    encoder,
    muxer,
    target,
    timer: window.setInterval(capture, Math.max(200, payload.intervalMs)),
    frames: 0,
    fps: payload.fps,
  };
  capture();
}

export async function finishRecording(): Promise<void> {
  const active = session;
  if (!active) {
    window.electronAPI?.recordingFailed?.('The recording had not started yet.');
    return;
  }
  session = null;

  window.clearInterval(active.timer);
  try {
    await active.encoder.flush();
    active.encoder.close();
    active.muxer.finalize();

    const buffer = active.target.buffer;
    const frames = Math.max(1, active.frames);
    active.stream.getTracks().forEach((track) => track.stop());
    active.video.srcObject = null;

    await window.electronAPI?.saveRecording?.(buffer, frames);
  } catch (err: any) {
    active.stream.getTracks().forEach((track) => track.stop());
    window.electronAPI?.recordingFailed?.(String(err?.message || err));
  }
}
