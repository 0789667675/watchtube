const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/web/src/components/player/VideoPlayer.tsx');
let content = fs.readFileSync(file, 'utf-8');

// Ensure we have axios imported
if (!content.includes('import axios')) {
    content = "import axios from 'axios';\n" + content;
}

const telemetryEffect = `
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

// Insert just before the last return (
const lines = content.split('\n');
const returnIndex = lines.findIndex(l => l.trim().startsWith('return ('));
if (returnIndex !== -1) {
    lines.splice(returnIndex, 0, telemetryEffect);
    fs.writeFileSync(file, lines.join('\n'));
}
