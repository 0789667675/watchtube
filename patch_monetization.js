const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/api/src/routes/monetization.route.ts');
let content = fs.readFileSync(file, 'utf-8');

// Replace GET /config
const newConfig = `
monetizationRouter.get('/config', async (req: Request, res: Response) => {
  try {
    const providers = await prisma.adProviderConfig.findMany({
      where: { isEnabled: true },
      orderBy: { priority: 'asc' }
    });

    // If no providers exist, return defaults
    if (providers.length === 0) {
      res.status(200).json({
        enabled: true,
        adSkipOffsetSeconds: 5,
        providers: [
          { name: 'ADSTERRA', vastTagUrl: 'https://vast.adsterra.com/vast?id=mock', format: 'PRE_ROLL' },
          { name: 'GOOGLE_IMA', vastTagUrl: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=', format: 'PRE_ROLL' }
        ]
      });
      return;
    }

    res.status(200).json({
      enabled: true,
      providers,
      adSkipOffsetSeconds: 5
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
`;

content = content.replace(/monetizationRouter\.get\('\/config'[\s\S]*?\}\);/m, newConfig.trim());
fs.writeFileSync(file, content);
