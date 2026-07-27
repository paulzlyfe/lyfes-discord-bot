import { Router, type IRouter } from "express";
import healthRouter from "./health";
import githubWebhookRouter from "./github-webhook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(githubWebhookRouter);

export default router;
