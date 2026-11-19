"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWtppReviewRouter = createWtppReviewRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const reviewSchema = zod_1.z.object({
    status: zod_1.z.enum(['APPROVED', 'REJECTED']),
    reviewerNotes: zod_1.z.string().trim().max(1000).optional(),
}).strict().superRefine((value, context) => {
    if (value.status === 'REJECTED' && !value.reviewerNotes) {
        context.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['reviewerNotes'],
            message: 'A reason is required when rejecting an application.',
        });
    }
});
function createWtppReviewRouter(repository) {
    const router = express_1.default.Router();
    router.patch('/:id', async (req, res) => {
        const applicationId = zod_1.z.string().uuid().safeParse(req.params.id);
        const decision = reviewSchema.safeParse(req.body);
        if (!applicationId.success || !decision.success) {
            res.status(400).json({ error: 'Invalid review decision or missing rejection reason.' });
            return;
        }
        try {
            const application = await repository.reviewPendingApplication({
                applicationId: applicationId.data,
                status: decision.data.status,
                reviewerNotes: decision.data.reviewerNotes || null,
            });
            if (!application) {
                res.status(409).json({ error: 'Only pending applications can be reviewed.' });
                return;
            }
            res.status(200).json(application);
        }
        catch (error) {
            console.error('WTPP application review failed.', {
                name: error instanceof Error ? error.name : 'UnknownError',
            });
            res.status(500).json({ error: 'Application review is temporarily unavailable.' });
        }
    });
    return router;
}
