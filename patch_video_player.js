const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/web/src/components/player/VideoPlayer.tsx');
let content = fs.readFileSync(file, 'utf-8');

// The naive string splice accidentally put useEffect inside another useEffect return
// We will manually fix it by reconstructing the file

const preRollAdOverlay = `
  const [showAd, setShowAd] = useState(false);
  const [adTimeLeft, setAdTimeLeft] = useState(5);

  useEffect(() => {
    // Simulated VAST Ad Request
    const checkMonetization = async () => {
        if (!videoId) return;
        try {
            const res = await axios.get('/api/v1/monetization/config');
            if (res.data.enabled) {
                // mock pre-roll trigger
                setShowAd(true);
                axios.post('/api/v1/monetization/ad-event', {
                    videoId, eventType: 'AD_REQUEST', provider: 'GOOGLE_IMA', sessionId: 'client-session-id'
                }).catch(() => {});
                axios.post('/api/v1/monetization/ad-event', {
                    videoId, eventType: 'AD_SERVED', provider: 'GOOGLE_IMA', sessionId: 'client-session-id'
                }).catch(() => {});
            }
        } catch (e) {}
    };
    checkMonetization();
  }, [videoId]);

  useEffect(() => {
      let timer: number | ReturnType<typeof setInterval>;
      if (showAd && adTimeLeft > 0) {
          timer = setInterval(() => {
              setAdTimeLeft(prev => prev - 1);
          }, 1000);
      } else if (showAd && adTimeLeft === 0) {
          axios.post('/api/v1/monetization/ad-event', {
              videoId, eventType: 'AD_VIEWABLE', provider: 'GOOGLE_IMA', sessionId: 'client-session-id'
          }).catch(() => {});
      }
      return () => clearInterval(timer);
  }, [showAd, adTimeLeft, videoId]);

  const skipAd = () => {
      setShowAd(false);
      togglePlay();
  };

  const adOverlayRender = showAd ? (
      <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center text-white">
          <div className="text-xl font-bold font-display mb-4">Advertisement</div>
          <div className="text-sm text-gray-400 mb-8">Video will resume shortly...</div>

          <div className="absolute bottom-16 right-4 flex gap-4">
              <div className="bg-gray-800/80 px-4 py-2 rounded">
                  Ad \u00B7 {adTimeLeft > 0 ? adTimeLeft : 0}:05
              </div>
              {adTimeLeft === 0 && (
                  <button onClick={skipAd} className="bg-brand-light dark:bg-brand-dark px-4 py-2 rounded font-bold hover:opacity-90">
                      Skip Ad
                  </button>
              )}
          </div>
      </div>
  ) : null;
`;

// Insert it right after the states declarations
const stateEndRegex = /const \[levels, setLevels\] = useState<\{height: number; index: number\}\[\]>\(\[\]\);/g;
let match = stateEndRegex.exec(content);
if (match) {
    const insertIdx = match.index + match[0].length;
    content = content.slice(0, insertIdx) + '\n' + preRollAdOverlay + '\n' + content.slice(insertIdx);
}

// insert the {adOverlayRender} directly below the <video/>
const videoEndRegex = /<video[\s\S]*?\/>/g;
let vMatch = videoEndRegex.exec(content);
if (vMatch) {
    const vInsertIdx = vMatch.index + vMatch[0].length;
    content = content.slice(0, vInsertIdx) + '\n      {adOverlayRender}\n' + content.slice(vInsertIdx);
}

fs.writeFileSync(file, content);
