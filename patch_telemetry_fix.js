const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/web/src/components/player/VideoPlayer.tsx');
let content = fs.readFileSync(file, 'utf-8');

// The naive string splice accidentally put useEffect inside another useEffect return
// We will manually fix it by reconstructing the file

content = content.replace(/\/\/ Telemetry Engine Heartbeat[\s\S]*?}, \[isPlaying, videoId\]\);/g, '');

const telemetryFix = `
  // Telemetry Engine Heartbeat
  useEffect(() => {
    let interval: number | ReturnType<typeof setInterval>;

    if (isPlaying && videoId) {
      interval = setInterval(() => {
        if (videoRef.current) {
          const currentPosition = videoRef.current.currentTime;
          const duration = videoRef.current.duration;
          const completed = currentPosition >= duration * 0.95;

          // Send beacon without blocking main thread
          axios.post('/api/v1/analytics/telemetry', {
            videoId,
            sessionId: 'client-session-id', // normally generated once per app load
            currentPosition,
            durationWatched: 5,
            completed
          }).catch(console.error);
        }
      }, 5000);
    }

    return () => clearInterval(interval);
  }, [isPlaying, videoId]);
`;

// Insert it right after const toggleFullscreen = () => { ... }
// wait, that's inside the component, before return (
const toggleFullscreenRegex = /const toggleFullscreen = \(\) => {[\s\S]*?};/g;
let match = toggleFullscreenRegex.exec(content);
if (match) {
    const insertIdx = match.index + match[0].length;
    content = content.slice(0, insertIdx) + '\n' + telemetryFix + '\n' + content.slice(insertIdx);
}

fs.writeFileSync(file, content);
