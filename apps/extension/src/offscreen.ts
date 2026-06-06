/**
 * Offscreen document — runs in a hidden page context.
 *
 * Can call getUserMedia (for tab capture via chromeMediaSource:'tab')
 * and use livekit-client to publish the stream.
 */

import { Room, Track } from "livekit-client";

let livekitRoom: Room | null = null;
let localAudio: HTMLAudioElement | null = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "START_PUBLISH") {
    startPublish(msg.streamId, msg.livekitUrl, msg.livekitToken).catch(console.error);
  }
  if (msg.type === "STOP_PUBLISH") {
    stopPublish();
  }
});

async function startPublish(streamId: string, livekitUrl: string, livekitToken: string) {
  // Capture the tab stream (video + audio)
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-expect-error — Chrome-specific constraint
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      // @ts-expect-error — Chrome-specific constraint
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  });

  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];

  // Start local audio immediately — don't wait for LiveKit.
  // Chrome mutes the captured tab; we restore it by playing the captured stream locally.
  if (audioTrack) {
    localAudio = new Audio();
    localAudio.srcObject = new MediaStream([audioTrack.clone()]);
    localAudio.volume = 1;
    localAudio.play().catch(console.error);
  }

  // Tell content script to start reporting state
  chrome.runtime.sendMessage({ type: "FORWARD_TO_CONTENT", inner: { type: "START_REPORTING" } });

  // Connect to LiveKit and publish in the background (doesn't block local audio)
  const room = new Room();
  livekitRoom = room;

  await room.connect(livekitUrl, livekitToken);

  if (videoTrack) {
    await room.localParticipant.publishTrack(videoTrack, {
      name: "screen",
      source: Track.Source.ScreenShare,
      videoEncoding: {
        maxBitrate: 8_000_000,
        maxFramerate: 30,
      },
      simulcast: false,
    });
  }

  if (audioTrack) {
    await room.localParticipant.publishTrack(audioTrack, {
      name: "screen-audio",
      source: Track.Source.ScreenShareAudio,
    });
  }
}

function stopPublish() {
  localAudio?.pause();
  localAudio = null;
  livekitRoom?.disconnect();
  livekitRoom = null;
  chrome.runtime.sendMessage({ type: "FORWARD_TO_CONTENT", inner: { type: "STOP_REPORTING" } });
}
