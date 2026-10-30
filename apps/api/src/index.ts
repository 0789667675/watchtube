import express, { Request, Response } from 'express';
import helmet from 'helmet';

const app = express();
const port = process.env.PORT || 3001;

app.use(helmet());
app.use(express.json());

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// API Router
const apiRouter = express.Router();
apiRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Welcome to WatchTube API v1' });
});

app.use('/api/v1', apiRouter);

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
