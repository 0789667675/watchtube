"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWtppApplicationsRouter = createWtppApplicationsRouter;
const express_1 = __importDefault(require("express"));
function createWtppApplicationsRouter(repository) {
    const router = express_1.default.Router();
    router.get('/', async (_req, res) => {
        try {
            const applications = await repository.listPendingApplications();
            res.status(200).json(applications.map((application) => ({
                id: application.id,
                channelWatchHours: application.channelWatchHours,
                subscriberCount: application.subscriberCount,
                submittedAt: application.submittedAt,
                channel: {
                    name: application.channel.name,
                    handle: application.channel.handle,
                },
            })));
        }
        catch (error) {
            console.error('WTPP applications listing failed.', {
                name: error instanceof Error ? error.name : 'UnknownError',
            });
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.get('/:id', async (req, res) => {
        try {
            if (!repository.getApplicationById) {
                res.status(501).json({ error: 'Application lookup not supported.' });
                return;
            }
            const application = await repository.getApplicationById(req.params.id);
            if (!application) {
                res.status(404).json({ error: 'Application not found' });
                return;
            }
            res.status(200).json(application);
        }
        catch (error) {
            console.error('WTPP application lookup failed.', {
                name: error instanceof Error ? error.name : 'UnknownError',
            });
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
