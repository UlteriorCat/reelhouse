// Generates the small test videos the E2E suite plays (real files, so codec behaviour is real, not simulated).
//   npm run e2e:media            (needs ffmpeg on PATH, or FFMPEG=/path/to/ffmpeg)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.env.E2E_MEDIA || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'media');
const ff = process.env.FFMPEG || 'ffmpeg';
fs.mkdirSync(out, { recursive: true });
const SRC = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-shortest'];
const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
const jobs = {
  'test.mp4': [...H264, '-c:a', 'aac', '-movflags', '+faststart'],                    // plays everywhere
  'test.mov': [...H264, '-c:a', 'aac', '-f', 'mov'],                                   // MOV container, H.264/AAC
  'test.mkv': [...H264, '-c:a', 'aac'],                                                // MKV container, H.264/AAC
  'test_ac3.mkv': [...H264, '-c:a', 'ac3'],                                            // video plays, audio is silent in Chromium
  'test_hevc.mp4': ['-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac'], // loads as 0x0 video in Chromium
  'test.webm': ['-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus'],
};
for (const [name, args] of Object.entries(jobs)) {
  const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...SRC, ...args, path.join(out, name)], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`ffmpeg failed for ${name}`); process.exit(1); }
  console.log('made', name);
}
// 150 s clip for resume / next-episode tests (resume only applies past 30 s)
const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '150', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '36', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart', path.join(out, 'test_long.mp4')], { stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
console.log('made test_long.mp4');
// HLS shaped like the Fendrix CDN: playlist and segments named .jpg (served as image/jpeg upstream)
fs.mkdirSync(path.join(out, 'hls', '1080p'), { recursive: true });
const hls = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...SRC, ...H264, '-g', '24', '-c:a', 'aac', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(out, 'hls', '1080p', 'playlist_%03d.jpg'), path.join(out, 'hls', '1080p', 'playlist.jpg')], { stdio: 'inherit' });
if (hls.status !== 0) process.exit(1);
fs.writeFileSync(path.join(out, 'hls', 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=4692000,RESOLUTION=1920x1080,NAME="1080p"\n1080p/playlist.jpg\n');
console.log('made hls/ (master.m3u8 + 1080p/playlist.jpg)\nmedia written to', out);
